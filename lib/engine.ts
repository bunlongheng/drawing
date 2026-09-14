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
  MIN_SAMPLE_DISTANCE,
  type BloomPass,
  type Brush,
  type NeonStyle,
  distance,
  findColor,
  findStyle,
  hueOffsetAt,
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

/** Device-pixel rectangle. */
export type Rect = { x: number; y: number; w: number; h: number };

export type Stroke = {
  styleId: string;
  colorId: string;
  size: number;
  samples: Sample[];
  /** Painted extent in CSS px, grown as segments land. */
  bounds: Bounds;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const EMPTY_BOUNDS = (): Bounds => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function grow(bounds: Bounds, x: number, y: number, reach: number): void {
  bounds.minX = Math.min(bounds.minX, x - reach);
  bounds.minY = Math.min(bounds.minY, y - reach);
  bounds.maxX = Math.max(bounds.maxX, x + reach);
  bounds.maxY = Math.max(bounds.maxY, y + reach);
}

export type { Brush };

export type EngineState = { canUndo: boolean; canRedo: boolean; isEmpty: boolean };

/** Retina is plenty; beyond it the bloom passes cost more than they show. */
const MAX_DPR = 2.5;

/**
 * Blur is a low-frequency effect, so the blurred passes are accumulated at a
 * quarter resolution and scaled back up. Sixteen times fewer pixels, and no
 * visible difference in a glow.
 */
const BLOOM_SCALE = 4;

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
  /** Downsampled source and accumulator for the blurred passes. */
  private readonly patch = document.createElement("canvas");
  private readonly patchGlow = document.createElement("canvas");
  private committedCtx: CanvasRenderingContext2D;
  private tubeCtx: CanvasRenderingContext2D;
  private coreCtx: CanvasRenderingContext2D;
  private glowCtx: CanvasRenderingContext2D;
  private patchCtx: CanvasRenderingContext2D;
  private patchGlowCtx: CanvasRenderingContext2D;

  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private current: Stroke | null = null;
  private lastSample: Sample | null = null;
  private lastTime = 0;
  /** Extent painted since the last frame, i.e. the part of `glow` to rebuild. */
  private pending: Bounds = EMPTY_BOUNDS();

  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private dirty = false;
  /** Device-px region the next frame must recomposite; null means everything. */
  private damage: Rect | null = null;
  private fullRepaint = true;

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
    this.patchCtx = context(this.patch);
    this.patchGlowCtx = context(this.patchGlow);
  }

  /** Resize to CSS pixel dimensions, preserving artwork by re-rendering it. */
  resize(width: number, height: number, dpr: number): void {
    const nextDpr = Math.min(dpr || 1, MAX_DPR);
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
      bounds: EMPTY_BOUNDS(),
    };
    this.lastSample = null;
    this.lastTime = performance.now();
    this.pending = EMPTY_BOUNDS();
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

  end(): void {
    const stroke = this.current;
    this.current = null;
    this.lastSample = null;
    if (!stroke || stroke.samples.length === 0) return;

    this.strokes.push(stroke);
    this.redoStack = [];
    this.refreshGlow(stroke);
    this.committedCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.committedCtx.globalCompositeOperation = "lighter";
    this.committedCtx.drawImage(this.glow, 0, 0);
    this.committedCtx.globalCompositeOperation = "source-over";
    this.clearScratch();
    this.requestPaint();
    this.emit();
  }

  undo(): void {
    const stroke = this.strokes.pop();
    if (!stroke) return;
    this.redoStack.push(stroke);
    this.redrawCommitted();
    this.requestPaint();
    this.emit();
  }

  redo(): void {
    const stroke = this.redoStack.pop();
    if (!stroke) return;
    this.strokes.push(stroke);
    this.replay(stroke);
    this.requestPaint();
    this.emit();
  }

  clear(): void {
    if (this.strokes.length === 0 && !this.current) return;
    this.strokes = [];
    this.redoStack = [];
    this.current = null;
    this.lastSample = null;
    this.redrawCommitted();
    this.requestPaint();
    this.emit();
  }

  get state(): EngineState {
    return {
      canUndo: this.strokes.length > 0,
      canRedo: this.redoStack.length > 0,
      isEmpty: this.strokes.length === 0,
    };
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
    this.frame = 0;
  }

  private emit(): void {
    this.onStateChange(this.state);
  }

  /** Queue a frame that recomposites the whole canvas. */
  private requestPaint(): void {
    this.fullRepaint = true;
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
    this.blit(this.committed, rect);
    if (this.current) this.blit(this.glow, rect);
    ctx.globalCompositeOperation = "source-over";
  }

  private blit(source: HTMLCanvasElement, rect: Rect): void {
    this.displayCtx.drawImage(
      source,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
    );
  }

  private clearScratch(): void {
    for (const ctx of [this.tubeCtx, this.coreCtx, this.glowCtx]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.tube.width, this.tube.height);
    }
    this.pending = EMPTY_BOUNDS();
  }

  /**
   * Rebuild only the part of `glow` that the last few samples touched. Bloom
   * over a small rectangle is cheap; over the whole stroke it is not.
   */
  private refreshGlow(stroke: Stroke): Rect | null {
    const style = findStyle(stroke.styleId);
    const rect = this.damageRect(this.pending, style, stroke.size);
    this.pending = EMPTY_BOUNDS();
    if (!rect) return null;

    this.glowCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.glowCtx.clearRect(rect.x, rect.y, rect.w, rect.h);
    this.bloom(this.glowCtx, stroke, rect);
    return rect;
  }

  /** Paint a finished stroke straight into the artwork. */
  private replay(stroke: Stroke): void {
    this.clearScratch();
    this.paintStroke(stroke);
    const rect = this.damageRect(stroke.bounds, findStyle(stroke.styleId), stroke.size);
    if (rect) this.bloom(this.committedCtx, stroke, rect);
    this.clearScratch();
  }

  private redrawCommitted(): void {
    this.committedCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.committedCtx.clearRect(0, 0, this.committed.width, this.committed.height);
    for (const stroke of this.strokes) this.replay(stroke);
  }

  private redrawLive(): void {
    this.clearScratch();
    if (this.current) this.paintStroke(this.current);
  }

  /** Paint a whole stroke into the (already cleared) scratch layers. */
  private paintStroke(stroke: Stroke): void {
    const { samples } = stroke;
    if (samples.length === 0) return;
    stroke.bounds = EMPTY_BOUNDS();
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
    const hsl = findColor(stroke.colorId).hsl;
    const hueOffset = hueOffsetAt(style, to.d);
    const width = (from.w + to.w) / 2;
    // A zero-length path is unreliable across engines; nudge it into a dot.
    const toX = from.x === to.x && from.y === to.y ? to.x + 0.01 : to.x;

    const reach = (width * Math.max(style.tube, 1)) / 2;
    for (const bounds of [stroke.bounds, this.pending]) {
      grow(bounds, from.x, from.y, reach);
      grow(bounds, toX, to.y, reach);
    }

    const passes: [CanvasRenderingContext2D, number, string][] = [
      [this.tubeCtx, style.tube, inkColor(hsl, 0, hueOffset)],
      [this.coreCtx, style.core, inkColor(hsl, style.coreWhite, hueOffset)],
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
    const outer = this.expand(inner, this.bloomPad(style, stroke.size));

    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.beginPath();
    target.rect(inner.x, inner.y, inner.w, inner.h);
    target.clip();
    target.globalCompositeOperation = "lighter";
    target.filter = "none";

    // The sharp passes carry the crisp edge, so they stay at full resolution.
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

  /** How far the widest blur of a style reaches, in device px. */
  private bloomPad(style: NeonStyle, size: number): number {
    const widest = Math.max(0, ...style.bloom.map((pass) => pass.blur)) * size;
    // A CSS blur of radius r has faded out by about 3r.
    return widest * 3 * this.dpr + 2;
  }

  private expand(rect: Rect, pad: number): Rect {
    const x = Math.max(0, Math.floor(rect.x - pad));
    const y = Math.max(0, Math.floor(rect.y - pad));
    return {
      x,
      y,
      w: Math.min(this.tube.width, Math.ceil(rect.x + rect.w + pad)) - x,
      h: Math.min(this.tube.height, Math.ceil(rect.y + rect.h + pad)) - y,
    };
  }

  /** A painted extent plus the reach of the style's widest blur, in device px. */
  private damageRect(bounds: Bounds, style: NeonStyle, size: number): Rect | null {
    const { minX, minY, maxX, maxY } = bounds;
    if (!Number.isFinite(minX)) return null;

    const pad = this.bloomPad(style, size);
    const x = Math.max(0, Math.floor(minX * this.dpr - pad));
    const y = Math.max(0, Math.floor(minY * this.dpr - pad));
    const right = Math.min(this.tube.width, Math.ceil(maxX * this.dpr + pad));
    const bottom = Math.min(this.tube.height, Math.ceil(maxY * this.dpr + pad));
    if (right <= x || bottom <= y) return null;
    return { x, y, w: right - x, h: bottom - y };
  }

  private add(
    target: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    blur: number,
    alpha: number,
    rect: Rect,
  ): void {
    if (blur > 0 && !supportsFilter) return;
    target.filter = blur > 0 ? `blur(${blur.toFixed(2)}px)` : "none";
    target.globalAlpha = alpha;
    target.drawImage(source, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  }
}
