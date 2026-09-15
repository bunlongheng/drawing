/**
 * Canvas engine. Owns the pixels so React never re-renders while a stroke is
 * in flight.
 *
 * A stroke is painted twice, opaquely, into two scratch layers: `tube` (the
 * coloured body) and `core` (the hot centre). Painting opaquely makes
 * re-stroking a pixel a no-op, which is what keeps a slow stroke from beading
 * at its round caps, and keeping the core on its own layer stops the next
 * segment's tube from burying it.
 *
 * The neon look is then bloom: the scratch layers are added back onto the
 * artwork several times at increasing blur radii. Additive light burns the
 * centre toward white while the falloff stays saturated.
 *
 *   tube + core  ->  bloom  ->  glow  ->  committed  ->  display
 *
 * Bloom is the expensive step, so the live stroke keeps its result in `glow`
 * and only re-blooms the rectangle that changed since the last frame.
 */

import {
  DEFAULT_EFFECT_ID,
  FLOW_DUST_SPAN,
  FLOW_TRAIL,
  type EffectId,
  brightnessAt,
  dustAt,
  flowHeadAt,
  hasParticles,
  moteRadius,
  particlesAt,
} from "./effects";
import {
  type Bounds,
  type Rect,
  bloomPad,
  damageRect,
  emptyBounds,
  expandRect,
  growBounds,
  unionRect,
} from "./geometry";
import {
  MIN_SAMPLE_DISTANCE,
  type BloomPass,
  type Brush,
  type Hsl,
  type NeonStyle,
  distance,
  findColor,
  findStyle,
  colorAt,
  inkColor,
  sampleWidth,
} from "./neon";

export type Sample = {
  x: number;
  y: number;
  /** Rendered width in CSS px for this sample. */
  w: number;
  /** Cumulative distance from the stroke start, in CSS px. */
  d: number;
};

export type Stroke = {
  styleId: string;
  colorId: string;
  size: number;
  samples: Sample[];
  /** Painted extent in CSS px, grown as segments land. */
  bounds: Bounds;
};

export type { Brush };
export type { Rect };

export type EngineState = {
  canUndo: boolean;
  canRedo: boolean;
  isEmpty: boolean;
  /** True while a replay is running, so the toolbar can show Stop. */
  replaying: boolean;
};

/** One point of the artwork, used to place particles and the replay head. */
type IndexPoint = { x: number; y: number; hsl: Hsl };

/**
 * CSS pixels of line a replay paints per second at 1x.
 *
 * Distance, not samples: a quick stroke records its samples further apart, so
 * a per-sample rate replayed a hurried line faster than a careful one. Pacing
 * by distance means 1x is the same visible speed whatever was drawn, and every
 * multiple of it is predictable.
 */
const REPLAY_PX_PER_SECOND = 210;

/** At most this many points back the artwork for particles - plenty, and cheap. */
const MAX_INDEX = 900;

/**
 * Longest edge of a recorded clip. The canvas can be 2700px wide on an iPad,
 * and encoding that is a large file for no visible gain once it is played back
 * on a phone. 1920 keeps it sharp and keeps the file small.
 */
const CLIP_MAX_EDGE = 1920;

/** Frames per second a clip is captured at. */
const CLIP_FPS = 30;

/** Held at the end of a clip so the finished drawing is actually seen. */
const CLIP_TAIL_MS = 900;

/** Preferred first: MP4 plays everywhere, WebM is the fallback. */
const CLIP_TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/**
 * Resolution is governed by a pixel budget rather than a fixed ratio.
 *
 * A flat cap blurred the drawing exactly when someone zoomed in: the browser
 * raises devicePixelRatio and shrinks the CSS box, and the cap threw the extra
 * detail away. A budget does the opposite - zooming shrinks the CSS area, which
 * buys a higher ratio and a sharper line, while a large window stays within
 * what six full-screen canvases can afford.
 */
const MAX_CANVAS_PIXELS = 6_000_000;
const MAX_DPR = 4;

function fitDpr(width: number, height: number, dpr: number): number {
  const area = Math.max(1, width * height);
  const budgeted = Math.min(dpr || 1, MAX_DPR, Math.sqrt(MAX_CANVAS_PIXELS / area));
  // Never render below CSS resolution: the budget caps sharpness, it must not
  // make a very large canvas soft.
  return Math.max(1, budgeted);
}

/**
 * Blurred passes are accumulated at half resolution and scaled back up. A
 * quarter was cheaper still, but the upscale showed: the falloff went chunky
 * against a sharp core, which reads as a blurry drawing rather than a soft one.
 */
const BLOOM_SCALE = 2;

/**
 * Undo cannot subtract additive pixels, so it rebuilds from the stroke list.
 * A snapshot every N strokes caps that rebuild at N replays instead of all of
 * them - at 300 strokes an undo measured 582ms before this, and one snapshot
 * canvas is cheaper than the stutter.
 */
const CHECKPOINT_EVERY = 20;

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** Safari only gained `ctx.filter` in 17; without it the glow is simply flat. */
const supportsFilter =
  typeof CanvasRenderingContext2D !== "undefined" &&
  "filter" in CanvasRenderingContext2D.prototype;

export class NeonEngine {
  private readonly display: HTMLCanvasElement;
  private readonly displayCtx: CanvasRenderingContext2D;
  private readonly committed = document.createElement("canvas");
  private readonly tube = document.createElement("canvas");
  private readonly core = document.createElement("canvas");
  private readonly glow = document.createElement("canvas");
  /** Snapshot of `committed` after `checkpointCount` strokes. Sized on first use. */
  private readonly checkpoint = document.createElement("canvas");
  /** Downsampled source and accumulator for the blurred passes. */
  private readonly patch = document.createElement("canvas");
  private readonly patchGlow = document.createElement("canvas");
  private committedCtx: CanvasRenderingContext2D;
  private tubeCtx: CanvasRenderingContext2D;
  private coreCtx: CanvasRenderingContext2D;
  private glowCtx: CanvasRenderingContext2D;
  private checkpointCtx: CanvasRenderingContext2D;
  private checkpointCount = 0;
  private patchCtx: CanvasRenderingContext2D;
  private patchGlowCtx: CanvasRenderingContext2D;

  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private current: Stroke | null = null;
  private lastSample: Sample | null = null;
  private lastTime = 0;
  /** Extent painted since the last frame, i.e. the part of `glow` to rebuild. */
  private pending: Bounds = emptyBounds();

  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private dirty = false;

  private effectId: EffectId = DEFAULT_EFFECT_ID;
  /** rAF handle for the continuous loop that animation and replay need. */
  private loop = 0;
  /** Flat sample of the artwork, rebuilt when the stroke list changes. */
  private index: IndexPoint[] = [];
  private indexStale = true;
  private replayState: {
    stroke: number;
    sample: number;
    budget: number;
    last: number;
    speed: number;
  } | null = null;
  /** Resolved when the running replay reaches the end. */
  private onReplayDone: (() => void) | null = null;
  /** Mirror of the display, sized for encoding, live only while recording. */
  private clip: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  /** Device-px region the next frame must recomposite. */
  private damage: Rect | null = null;
  private fullRepaint = true;
  /** Set when `committed` must be rebuilt from `strokes` before the next paint. */
  private committedStale = false;

  constructor(
    display: HTMLCanvasElement,
    private onStateChange: (state: EngineState) => void,
  ) {
    this.display = display;
    this.displayCtx = context(display);
    this.committedCtx = context(this.committed);
    this.tubeCtx = context(this.tube);
    this.coreCtx = context(this.core);
    this.glowCtx = context(this.glow);
    this.checkpointCtx = context(this.checkpoint);
    this.patchCtx = context(this.patch);
    this.patchGlowCtx = context(this.patchGlow);
  }

  /** Resize to CSS pixel dimensions, preserving artwork by re-rendering it. */
  resize(width: number, height: number, dpr: number): void {
    const nextDpr = fitDpr(width, height, dpr);
    if (width === this.width && height === this.height && nextDpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = nextDpr;

    for (const canvas of [this.display, this.committed, this.tube, this.core, this.glow]) {
      canvas.width = Math.max(1, Math.round(width * nextDpr));
      canvas.height = Math.max(1, Math.round(height * nextDpr));
    }
    // getContext returns the same object, but the resize reset its state.
    this.committedCtx = context(this.committed);
    this.tubeCtx = context(this.tube);
    this.coreCtx = context(this.core);
    this.glowCtx = context(this.glow);
    // Every stroke is about to be repainted at the new size, so the snapshot
    // is stale by definition.
    this.checkpointCount = 0;

    this.redrawCommitted();
    this.redrawLive();
    this.requestPaint();
  }

  begin(brush: Brush, x: number, y: number, pressure: number, isPen: boolean): void {
    this.current = {
      styleId: brush.styleId,
      colorId: brush.colorId,
      size: brush.size,
      samples: [],
      bounds: emptyBounds(),
    };
    this.lastSample = null;
    this.lastTime = performance.now();
    this.pending = emptyBounds();
    this.clearScratch();
    this.extend(x, y, pressure, isPen);
  }

  extend(x: number, y: number, pressure: number, isPen: boolean): void {
    const stroke = this.current;
    if (!stroke) return;

    const previous = this.lastSample;
    const step = previous ? distance(previous.x, previous.y, x, y) : 0;
    if (previous && step < MIN_SAMPLE_DISTANCE) return;

    const now = performance.now();
    const speed = previous ? step / Math.max(1, now - this.lastTime) : 0;
    this.lastTime = now;

    const sample: Sample = {
      x,
      y,
      w: sampleWidth(stroke.size, pressure, speed, isPen),
      d: (previous?.d ?? 0) + step,
    };
    stroke.samples.push(sample);
    this.paintSegment(stroke, previous ?? sample, sample);
    this.lastSample = sample;
    this.scheduleFrame();
  }

  /** Drop the stroke in progress without committing it. */
  cancel(): void {
    if (!this.current) return;
    this.current = null;
    this.lastSample = null;
    this.clearScratch();
    this.requestPaint();
  }

  end(): void {
    const stroke = this.current;
    this.current = null;
    this.lastSample = null;
    if (!stroke || stroke.samples.length === 0) return;

    this.strokes.push(stroke);
    this.redoStack = [];
    this.refreshGlow(stroke);

    // The glow already holds the finished stroke, so fold just its rectangle
    // into the artwork rather than blitting the whole canvas.
    const rect = this.strokeRect(stroke);
    this.committedCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.committedCtx.globalCompositeOperation = "lighter";
    if (rect) this.blitRect(this.committedCtx, this.glow, rect);
    this.committedCtx.globalCompositeOperation = "source-over";
    this.clearScratch();

    this.maybeCheckpoint();
    this.indexStale = true;
    this.requestPaint(rect);
    this.emit();
  }

  undo(): void {
    const stroke = this.strokes.pop();
    if (!stroke) return;
    this.redoStack.push(stroke);
    // Additive pixels cannot be subtracted, so undo rebuilds from the stroke
    // list. Defer it to the frame so holding the shortcut replays once, not
    // once per keypress.
    this.committedStale = true;
    this.indexStale = true;
    this.requestPaint();
    this.emit();
  }

  redo(): void {
    const stroke = this.redoStack.pop();
    if (!stroke) return;
    this.strokes.push(stroke);
    this.replay(stroke);
    this.indexStale = true;
    this.requestPaint(this.strokeRect(stroke));
    this.emit();
  }

  clear(): void {
    if (this.strokes.length === 0 && !this.current) return;
    this.strokes = [];
    this.redoStack = [];
    this.current = null;
    this.lastSample = null;
    this.checkpointCount = 0;
    this.committedStale = true;
    this.indexStale = true;
    this.replayState = null;
    this.requestPaint();
    this.syncLoop();
    this.emit();
  }

  get state(): EngineState {
    return {
      canUndo: this.strokes.length > 0,
      canRedo: this.redoStack.length > 0,
      isEmpty: this.strokes.length === 0,
      replaying: this.replayState !== null,
    };
  }

  /** Ambient animation. "off" stops the loop entirely rather than idling. */
  setEffect(id: EffectId): void {
    if (this.effectId === id) return;
    this.effectId = id;
    this.requestPaint();
    this.syncLoop();
  }

  /** Redraw everything from the start, at `speed` times the normal pace. */
  startReplay(speed: number): void {
    if (this.strokes.length === 0) return;
    this.current = null;
    this.lastSample = null;
    this.replayState = { stroke: 0, sample: 0, budget: 0, last: performance.now(), speed };
    this.committedCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.committedCtx.clearRect(0, 0, this.committed.width, this.committed.height);
    this.checkpointCount = 0;
    this.clearScratch();
    this.requestPaint();
    this.syncLoop();
    this.emit();
  }

  /** Change the pace of a running replay. */
  setReplaySpeed(speed: number): void {
    if (this.replayState) this.replayState.speed = speed;
  }

  /** How far through the replay we are, 0 to 1. */
  get replayProgress(): number {
    const replay = this.replayState;
    if (!replay) return 1;
    const total = this.strokes.reduce((n, stroke) => n + stroke.samples.length, 0);
    if (total === 0) return 1;
    let done = replay.sample;
    for (let i = 0; i < replay.stroke; i += 1) done += this.strokes[i].samples.length;
    return Math.min(1, done / total);
  }

  /** Stop a replay and put the finished drawing back on screen. */
  stopReplay(): void {
    if (!this.replayState) return;
    this.replayState = null;
    this.clearScratch();
    this.committedStale = true;
    this.requestPaint();
    this.syncLoop();
    this.emit();
  }

  /** The clip format this browser can actually encode, if any. */
  static clipMimeType(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    return CLIP_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
  }

  /**
   * Record a replay to a video file.
   *
   * Frames are mirrored into a smaller canvas and encoded from there: the
   * display can be 2700px wide, which makes a large file for no visible gain.
   */
  async recordReplay(
    speed: number,
    onProgress?: (fraction: number) => void,
  ): Promise<{ blob: Blob; type: string }> {
    const type = NeonEngine.clipMimeType();
    if (!type) throw new Error("This browser cannot record video");
    if (this.strokes.length === 0) throw new Error("Nothing to record");

    const scale = Math.min(1, CLIP_MAX_EDGE / Math.max(this.display.width, this.display.height));
    const canvas = document.createElement("canvas");
    // Even dimensions: H.264 will not encode an odd frame size.
    canvas.width = Math.max(2, Math.round((this.display.width * scale) / 2) * 2);
    canvas.height = Math.max(2, Math.round((this.display.height * scale) / 2) * 2);
    this.clip = { canvas, ctx: context(canvas) };

    const stream = canvas.captureStream(CLIP_FPS);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    let ticker = 0;
    try {
      recorder.start();
      // Paint one frame immediately so the clip opens on a black canvas.
      this.mirrorToClip();

      await new Promise<void>((resolve) => {
        this.onReplayDone = resolve;
        if (onProgress) {
          ticker = window.setInterval(() => onProgress(this.replayProgress), 120);
        }
        this.startReplay(speed);
      });

      // Hold on the finished drawing rather than cutting on the last stroke.
      await new Promise((resolve) => setTimeout(resolve, CLIP_TAIL_MS));
    } finally {
      if (ticker) clearInterval(ticker);
      if (recorder.state !== "inactive") recorder.stop();
      await finished;
      for (const track of stream.getTracks()) track.stop();
      this.clip = null;
    }

    onProgress?.(1);
    return { blob: new Blob(chunks, { type }), type };
  }

  /** PNG of exactly what is on screen, at device resolution. */
  toBlob(): Promise<Blob> {
    this.paint();
    return new Promise((resolve, reject) => {
      this.display.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the canvas as a PNG"));
      }, "image/png");
    });
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.loop) cancelAnimationFrame(this.loop);
    this.frame = 0;
    this.loop = 0;
    this.replayState = null;
  }

  private emit(): void {
    this.onStateChange(this.state);
  }

  /** Animation and replay need a frame every tick; nothing else does. */
  private syncLoop(): void {
    const wanted = this.effectId !== "off" || this.replayState !== null;
    if (wanted && !this.loop) {
      const tick = (now: number) => {
        this.loop = requestAnimationFrame(tick);
        if (this.replayState) this.advanceReplay(now);
        this.paintAnimated(now);
      };
      this.loop = requestAnimationFrame(tick);
    } else if (!wanted && this.loop) {
      cancelAnimationFrame(this.loop);
      this.loop = 0;
      this.requestPaint();
    }
  }

  /**
   * Full composite with the ambient animation on top.
   *
   * The damage-rect path cannot be used here: an envelope effect changes every
   * pixel of the artwork, and particles move anywhere.
   */
  private paintAnimated(nowMs: number): void {
    if (this.committedStale) {
      this.redrawCommitted();
      this.committedStale = false;
    }
    const seconds = nowMs / 1000;
    const ctx = this.displayCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.display.width, this.display.height);

    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = brightnessAt(this.effectId, seconds);
    ctx.drawImage(this.committed, 0, 0);
    ctx.globalAlpha = 1;

    // The stroke in hand, or the one a replay is partway through.
    if (this.current) this.refreshGlow(this.current);
    if (this.current || this.replayState) ctx.drawImage(this.glow, 0, 0);

    // Particles are placed along the finished artwork. Mid-replay half of it
    // is not on screen yet, so they would drift over blank canvas.
    if (!this.replayState && hasParticles(this.effectId)) this.paintParticles(ctx, seconds);
    ctx.globalCompositeOperation = "source-over";
    this.dirty = false;
    this.mirrorToClip();
  }

  /** Copy the finished frame into the (smaller) canvas being encoded. */
  private mirrorToClip(): void {
    const clip = this.clip;
    if (!clip) return;
    clip.ctx.drawImage(this.display, 0, 0, clip.canvas.width, clip.canvas.height);
  }

  /** A thinned-out copy of the artwork, for placing particles on it. */
  private artworkIndex(): IndexPoint[] {
    if (!this.indexStale) return this.index;
    this.indexStale = false;

    const total = this.strokes.reduce((n, stroke) => n + stroke.samples.length, 0);
    const step = Math.max(1, Math.ceil(total / MAX_INDEX));
    const points: IndexPoint[] = [];
    for (const stroke of this.strokes) {
      const color = findColor(stroke.colorId);
      for (let i = 0; i < stroke.samples.length; i += step) {
        const sample = stroke.samples[i];
        points.push({ x: sample.x, y: sample.y, hsl: colorAt(color, sample.d, stroke.size) });
      }
    }
    this.index = points;
    return points;
  }

  private paintParticles(ctx: CanvasRenderingContext2D, seconds: number): void {
    const points = this.artworkIndex();
    if (points.length === 0) return;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";

    this.paintDust(ctx, points, seconds);

    const base = moteRadius(this.effectId);
    if (this.effectId === "flow") {
      const head = Math.floor(flowHeadAt(seconds) * points.length);
      for (let i = FLOW_TRAIL - 1; i >= 0; i -= 1) {
        const point = points[(head - i + points.length * 2) % points.length];
        const fade = 1 - i / FLOW_TRAIL;
        this.paintMote(ctx, point, point.x, point.y, fade * fade, base * (0.35 + fade), false);
      }
    } else {
      for (const particle of particlesAt(this.effectId, seconds)) {
        if (particle.alpha <= 0.01) continue;
        const point = points[Math.min(points.length - 1, Math.floor(particle.at * points.length))];
        this.paintMote(
          ctx,
          point,
          point.x + particle.dx,
          point.y + particle.dy,
          particle.alpha,
          base * particle.scale,
          particle.star,
        );
      }
    }
    ctx.restore();
  }

  /**
   * The dust cloud: a hundred 1px squares of ink, scattered over the artwork.
   * Flow keeps its dust around the travelling head, where the light is.
   */
  private paintDust(
    ctx: CanvasRenderingContext2D,
    points: IndexPoint[],
    seconds: number,
  ): void {
    const head = this.effectId === "flow" ? flowHeadAt(seconds) : 0;
    for (const mote of dustAt(seconds)) {
      if (mote.alpha <= 0.02) continue;
      const at =
        this.effectId === "flow"
          ? (head + (mote.at - 0.5) * FLOW_DUST_SPAN + 1) % 1
          : mote.at;
      const point = points[Math.min(points.length - 1, Math.floor(at * points.length))];
      ctx.globalAlpha = mote.alpha;
      ctx.fillStyle = inkColor(point.hsl, 0.5);
      ctx.fillRect(point.x + mote.dx, point.y + mote.dy, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** One soft dot of light, optionally with a four-point glint through it. */
  private paintMote(
    ctx: CanvasRenderingContext2D,
    point: IndexPoint,
    x: number,
    y: number,
    alpha: number,
    radius: number,
    star: boolean,
  ): void {
    const core = inkColor(point.hsl, 0.85);
    const edge = inkColor(point.hsl, 0);

    const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
    halo.addColorStop(0, core);
    halo.addColorStop(0.28, edge);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (!star) return;
    const arm = radius * 1.9;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = core;
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - arm, y);
    ctx.lineTo(x + arm, y);
    ctx.moveTo(x, y - arm);
    ctx.lineTo(x, y + arm);
    ctx.stroke();
  }

  /** Paint the next slice of a replay. */
  private advanceReplay(nowMs: number): void {
    const replay = this.replayState;
    if (!replay) return;

    const elapsed = (nowMs - replay.last) / 1000;
    replay.last = nowMs;
    // A backgrounded tab can bank an enormous gap; cap it at a quarter second
    // so returning to the page does not skip most of the drawing.
    replay.budget += Math.min(elapsed, 0.25) * REPLAY_PX_PER_SECOND * replay.speed;
    if (replay.budget <= 0) return;

    while (replay.budget > 0 && replay.stroke < this.strokes.length) {
      const stroke = this.strokes[replay.stroke];
      const samples = stroke.samples;

      if (replay.sample === 0) {
        this.clearScratch();
        this.paintSegment(stroke, samples[0], samples[0]);
        replay.sample = 1;
        // A dot has no length, so charge it a nominal step to keep moving.
        replay.budget -= stroke.size / 2;
        continue;
      }

      const from = samples[replay.sample - 1];
      const to = samples[replay.sample];
      this.paintSegment(stroke, from, to);
      replay.budget -= Math.max(0.01, to.d - from.d);
      replay.sample += 1;

      if (replay.sample >= samples.length) {
        const rect = this.strokeRect(stroke);
        if (rect) this.bloom(this.committedCtx, stroke, rect);
        this.clearScratch();
        replay.stroke += 1;
        replay.sample = 0;
      }
    }

    if (replay.stroke >= this.strokes.length) {
      this.replayState = null;
      this.indexStale = true;
      const done = this.onReplayDone;
      this.onReplayDone = null;
      this.syncLoop();
      this.emit();
      done?.();
      return;
    }
    // Bloom the stroke still in progress so it grows on screen as it is drawn.
    this.refreshGlow(this.strokes[replay.stroke]);
  }

  /**
   * Queue a frame. With a rect only that region is recomposited; without one
   * the whole canvas is.
   */
  private requestPaint(rect?: Rect | null): void {
    if (rect) this.damage = unionRect(this.damage, rect);
    else this.fullRepaint = true;
    this.scheduleFrame();
  }

  /**
   * Queue a frame for a live-stroke change. The region is whatever `refreshGlow`
   * rebuilds, so nothing extra needs to be declared here.
   */
  private scheduleFrame(): void {
    this.dirty = true;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.dirty) this.paint();
    });
  }

  private paint(): void {
    this.dirty = false;
    if (this.committedStale) {
      this.redrawCommitted();
      this.committedStale = false;
      this.fullRepaint = true;
    }
    const glowRect = this.current ? this.refreshGlow(this.current) : null;
    const rect = this.fullRepaint
      ? { x: 0, y: 0, w: this.display.width, h: this.display.height }
      : unionRect(this.damage, glowRect);
    this.damage = null;
    this.fullRepaint = false;
    if (!rect || rect.w <= 0 || rect.h <= 0) return;

    const ctx = this.displayCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000000";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalCompositeOperation = "lighter";
    this.blitRect(ctx, this.committed, rect);
    if (this.current) this.blitRect(ctx, this.glow, rect);
    ctx.globalCompositeOperation = "source-over";
  }

  /** Copy one rectangle of `source` onto `target` at the same coordinates. */
  private blitRect(
    target: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    rect: Rect,
  ): void {
    target.drawImage(source, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  }

  /** The region a finished stroke occupies, glow included. */
  private strokeRect(stroke: Stroke): Rect | null {
    const style = findStyle(stroke.styleId);
    return damageRect(
      stroke.bounds,
      bloomPad(style, stroke.size, this.dpr),
      this.dpr,
      this.tube.width,
      this.tube.height,
    );
  }

  private clearScratch(): void {
    for (const ctx of [this.tubeCtx, this.coreCtx, this.glowCtx]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.tube.width, this.tube.height);
    }
    this.pending = emptyBounds();
  }

  /**
   * Rebuild only the part of `glow` that the last few samples touched. Bloom
   * over a small rectangle is cheap; over the whole stroke it is not.
   */
  private refreshGlow(stroke: Stroke): Rect | null {
    const style = findStyle(stroke.styleId);
    const rect = damageRect(
      this.pending,
      bloomPad(style, stroke.size, this.dpr),
      this.dpr,
      this.tube.width,
      this.tube.height,
    );
    this.pending = emptyBounds();
    if (!rect) return null;

    this.glowCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.glowCtx.clearRect(rect.x, rect.y, rect.w, rect.h);
    this.bloom(this.glowCtx, stroke, rect);
    return rect;
  }

  /**
   * Paint a finished stroke straight into the artwork. Only the stroke's own
   * rectangle is cleared afterwards - clearing three full-screen canvases per
   * stroke is what made a large undo expensive.
   */
  private replay(stroke: Stroke): void {
    this.paintStroke(stroke);
    const rect = this.strokeRect(stroke);
    if (rect) {
      this.bloom(this.committedCtx, stroke, rect);
      for (const ctx of [this.tubeCtx, this.coreCtx]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      }
    }
  }

  /** Take a snapshot of the artwork once enough strokes have accumulated. */
  private maybeCheckpoint(): void {
    if (this.strokes.length - this.checkpointCount < CHECKPOINT_EVERY) return;
    this.writeCheckpoint(this.strokes.length);
  }

  private writeCheckpoint(count: number): void {
    if (
      this.checkpoint.width !== this.committed.width ||
      this.checkpoint.height !== this.committed.height
    ) {
      this.checkpoint.width = this.committed.width;
      this.checkpoint.height = this.committed.height;
      this.checkpointCtx = context(this.checkpoint);
    }
    this.checkpointCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.checkpointCtx.clearRect(0, 0, this.checkpoint.width, this.checkpoint.height);
    this.checkpointCtx.drawImage(this.committed, 0, 0);
    this.checkpointCount = count;
  }

  /**
   * Rebuild the artwork from the stroke list, resuming from the snapshot when
   * it covers a prefix of what is left.
   */
  private redrawCommitted(): void {
    const resumable = this.checkpointCount > 0 && this.checkpointCount <= this.strokes.length;
    const from = resumable ? this.checkpointCount : 0;

    this.committedCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.committedCtx.clearRect(0, 0, this.committed.width, this.committed.height);
    if (resumable) this.committedCtx.drawImage(this.checkpoint, 0, 0);
    else this.checkpointCount = 0;

    this.clearScratch();
    // A full rebuild is the moment to leave a fresh snapshot behind.
    const snapshotAt = resumable ? -1 : this.strokes.length - CHECKPOINT_EVERY;
    for (let i = from; i < this.strokes.length; i += 1) {
      this.replay(this.strokes[i]);
      if (i + 1 === snapshotAt) this.writeCheckpoint(snapshotAt);
    }
  }

  private redrawLive(): void {
    this.clearScratch();
    if (this.current) this.paintStroke(this.current);
  }

  /** Paint a whole stroke into the (already cleared) scratch layers. */
  private paintStroke(stroke: Stroke): void {
    const { samples } = stroke;
    if (samples.length === 0) return;
    stroke.bounds = emptyBounds();
    if (samples.length === 1) {
      this.paintSegment(stroke, samples[0], samples[0]);
      return;
    }
    for (let i = 1; i < samples.length; i += 1) {
      this.paintSegment(stroke, samples[i - 1], samples[i]);
    }
  }

  /** One segment, painted opaquely into both scratch layers. */
  private paintSegment(stroke: Stroke, from: Sample, to: Sample): void {
    const style = findStyle(stroke.styleId);
    const hsl = colorAt(findColor(stroke.colorId), to.d, stroke.size);
    const width = (from.w + to.w) / 2;
    // A zero-length path is unreliable across engines; nudge it into a dot.
    const toX = from.x === to.x && from.y === to.y ? to.x + 0.01 : to.x;

    const reach = (width * Math.max(style.tube, 1)) / 2;
    for (const bounds of [stroke.bounds, this.pending]) {
      growBounds(bounds, from.x, from.y, reach);
      growBounds(bounds, toX, to.y, reach);
    }

    const passes: [CanvasRenderingContext2D, number, string][] = [
      [this.tubeCtx, style.tube, inkColor(hsl, 0)],
      [this.coreCtx, style.core, inkColor(hsl, style.coreWhite)],
    ];

    for (const [ctx, scale, css] of passes) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.4, width * scale);
      ctx.strokeStyle = css;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(toX, to.y);
      ctx.stroke();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /**
   * Add the scratch layers onto `target`: blurred copies of the tube for the
   * glow, then the core sharp and once softened.
   *
   * Only the stroke's own region is touched. Blurring the whole canvas on every
   * frame of a long stroke is the one thing that makes this expensive.
   */
  private bloom(target: CanvasRenderingContext2D, stroke: Stroke, inner: Rect): void {
    const style: NeonStyle = findStyle(stroke.styleId);
    const reach = stroke.size * this.dpr;
    // Read from a wider box than we write, so the glow of the rest of the
    // stroke still bleeds correctly into the edges of the rebuilt region.
    const outer = expandRect(
      inner,
      bloomPad(style, stroke.size, this.dpr),
      this.tube.width,
      this.tube.height,
    );
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.beginPath();
    target.rect(inner.x, inner.y, inner.w, inner.h);
    target.clip();
    target.globalCompositeOperation = "lighter";
    target.filter = "none";

    // The sharp passes carry the crisp edge, so they stay at full resolution.
    // They must also cover the whole of `inner`: refreshGlow clears that box and
    // the scratch layers hold the entire stroke, so narrowing them to the newest
    // samples erases earlier core pixels and leaves specks along the stroke.
    for (const pass of style.bloom) {
      if (pass.blur === 0) this.addSharp(target, this.tube, inner, pass.alpha);
    }
    this.addSharp(target, this.core, inner, 1);

    this.addSoft(
      target,
      this.tube,
      outer,
      style.bloom.filter((pass) => pass.blur > 0),
      reach,
    );
    this.addSoft(target, this.core, outer, [{ blur: style.core, alpha: 0.6 }], reach);

    target.filter = "none";
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
    target.restore();
  }

  private addSharp(
    target: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    rect: Rect,
    alpha: number,
  ): void {
    target.filter = "none";
    target.globalAlpha = alpha;
    target.drawImage(source, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  }

  /**
   * Accumulate the blurred passes at `1 / BLOOM_SCALE` resolution and blit the
   * result back up. Blurring at full size is what makes this slow - Skia
   * filters the whole source surface, not just the rectangle being drawn.
   */
  private addSoft(
    target: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    outer: Rect,
    passes: BloomPass[],
    reach: number,
  ): void {
    if (!supportsFilter || passes.length === 0) return;
    const w = Math.max(1, Math.ceil(outer.w / BLOOM_SCALE));
    const h = Math.max(1, Math.ceil(outer.h / BLOOM_SCALE));
    this.sizePatches(w, h);

    this.patchCtx.clearRect(0, 0, w, h);
    this.patchCtx.drawImage(source, outer.x, outer.y, outer.w, outer.h, 0, 0, w, h);

    const acc = this.patchGlowCtx;
    acc.clearRect(0, 0, w, h);
    acc.globalCompositeOperation = "lighter";
    for (const pass of passes) {
      acc.filter = `blur(${((pass.blur * reach) / BLOOM_SCALE).toFixed(2)}px)`;
      acc.globalAlpha = pass.alpha;
      acc.drawImage(this.patch, 0, 0, w, h, 0, 0, w, h);
    }
    acc.filter = "none";
    acc.globalAlpha = 1;
    acc.globalCompositeOperation = "source-over";

    target.filter = "none";
    target.globalAlpha = 1;
    target.drawImage(this.patchGlow, 0, 0, w, h, outer.x, outer.y, outer.w, outer.h);
  }

  /** Grow-only, so a long stroke does not reallocate every frame. */
  private sizePatches(w: number, h: number): void {
    for (const canvas of [this.patch, this.patchGlow]) {
      if (canvas.width >= w && canvas.height >= h) continue;
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    this.patchCtx = context(this.patch);
    this.patchGlowCtx = context(this.patchGlow);
  }

}
