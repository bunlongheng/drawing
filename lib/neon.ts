/**
 * Neon ink model: palette, style presets and the pure math behind stroke
 * rendering. Everything here is side-effect free so it can be unit tested
 * without a canvas.
 */

export type Hsl = { h: number; s: number; l: number };

export type NeonColor = {
  id: string;
  name: string;
  hsl: Hsl;
  /** Second stop. When present the ink is a gradient and blends toward it. */
  hsl2?: Hsl;
};

/** One additive copy of the stroke, blurred by `blur` and scaled by `alpha`. */
export type BloomPass = {
  /** Blur radius as a multiple of the brush size. 0 draws the sharp stroke. */
  blur: number;
  /** Weight of the copy in the additive sum. */
  alpha: number;
};

/**
 * A neon look is a bloom recipe.
 *
 * The stroke is painted twice - once as a solid coloured tube, once as a
 * narrow hot core - and the glow comes from adding blurred copies of the tube
 * back on top. Additive light is what makes the centre burn toward white while
 * the falloff stays saturated, which is exactly how a real neon tube reads.
 */
export type NeonStyle = {
  id: string;
  name: string;
  /** Width of the coloured tube as a multiple of the brush size. */
  tube: number;
  /** Width of the hot core as a multiple of the brush size. */
  core: number;
  /** How far the core burns toward white. 0 = pure hue, 1 = white. */
  coreWhite: number;
  /** Additive copies of the tube, ordered dimmest-first for readability. */
  bloom: BloomPass[];
};

export const COLORS: NeonColor[] = [
  { id: "cyan", name: "Cyan", hsl: { h: 186, s: 100, l: 55 } },
  { id: "magenta", name: "Magenta", hsl: { h: 320, s: 100, l: 58 } },
  { id: "lime", name: "Lime", hsl: { h: 140, s: 100, l: 52 } },
  { id: "amber", name: "Amber", hsl: { h: 38, s: 100, l: 55 } },
  { id: "violet", name: "Violet", hsl: { h: 266, s: 100, l: 64 } },
  { id: "rose", name: "Rose", hsl: { h: 345, s: 100, l: 60 } },
  { id: "white", name: "White", hsl: { h: 200, s: 30, l: 88 } },
  // Gradients: two stops the stroke eases between as it travels. Kept to
  // neighbouring hues so they read as one ink shifting, not as a rainbow.
  {
    id: "sunset",
    name: "Sunset",
    hsl: { h: 328, s: 96, l: 60 },
    hsl2: { h: 30, s: 98, l: 56 },
  },
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    hsl: { h: 276, s: 96, l: 64 },
    hsl2: { h: 190, s: 96, l: 56 },
  },
  {
    id: "toxic",
    name: "Toxic",
    hsl: { h: 150, s: 96, l: 52 },
    hsl2: { h: 52, s: 98, l: 56 },
  },
];

/**
 * Four looks that sit at the corners of a square, not along one dial: a line
 * with a glow, a glow with no line, a line that is almost all glow, and a line
 * with almost none.
 */
export const STYLES: NeonStyle[] = [
  {
    // The neon sign: white-hot centre inside a saturated halo.
    id: "classic",
    name: "Classic",
    tube: 1,
    core: 0.32,
    coreWhite: 0.9,
    bloom: [
      { blur: 3.0, alpha: 0.5 },
      { blur: 1.1, alpha: 0.5 },
      { blur: 0.35, alpha: 0.45 },
      { blur: 0, alpha: 0.45 },
    ],
  },
  {
    // No hard centre at all: a fat, soft, wholly coloured light.
    id: "halo",
    name: "Halo",
    tube: 2.0,
    core: 1.2,
    coreWhite: 0,
    bloom: [
      { blur: 5.0, alpha: 0.65 },
      { blur: 2.2, alpha: 0.55 },
      { blur: 0.9, alpha: 0.45 },
      { blur: 0, alpha: 0.28 },
    ],
  },
  {
    // A razor line of white with a tight, fierce halo around it.
    id: "laser",
    name: "Laser",
    tube: 0.3,
    core: 0.13,
    coreWhite: 1,
    bloom: [
      { blur: 2.2, alpha: 0.6 },
      { blur: 0.8, alpha: 0.6 },
      { blur: 0.25, alpha: 0.6 },
      { blur: 0, alpha: 0.75 },
    ],
  },
  {
    // Barely lit: a flat coloured line, the tube switched off.
    id: "wire",
    name: "Wire",
    tube: 0.5,
    core: 0.34,
    coreWhite: 0.15,
    bloom: [
      { blur: 0.5, alpha: 0.25 },
      { blur: 0, alpha: 0.85 },
    ],
  },
];

export type Brush = { styleId: string; colorId: string; size: number };

export const DEFAULT_STYLE_ID = "classic";
export const DEFAULT_COLOR_ID = "cyan";

export const MIN_SIZE = 2;
export const MAX_SIZE = 48;
export const DEFAULT_SIZE = 10;

export function findStyle(id: string): NeonStyle {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

export function findColor(id: string): NeonColor {
  return COLORS.find((c) => c.id === id) ?? COLORS[0];
}

/** Wrap a hue into [0, 360). */
export function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * CSS colour for a stroke pass: the base hue rotated by `hueOffset` and mixed
 * toward white by `white`.
 */
export function inkColor(base: Hsl, white: number, hueOffset = 0): string {
  const w = clamp(white, 0, 1);
  const h = wrapHue(base.h + hueOffset);
  const s = base.s * (1 - w);
  const l = base.l + (100 - base.l) * w;
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}


/** True when the ink blends between two stops rather than sitting on one hue. */
export function isGradient(color: NeonColor): boolean {
  return color.hsl2 !== undefined;
}

/**
 * Blend two colours, taking the short way around the hue circle so pink to
 * orange passes through red rather than the whole spectrum.
 */
export function mixHsl(a: Hsl, b: Hsl, t: number): Hsl {
  const k = clamp(t, 0, 1);
  const delta = (((b.h - a.h + 540) % 360) - 180) * k;
  return {
    h: wrapHue(a.h + delta),
    s: a.s + (b.s - a.s) * k,
    l: a.l + (b.l - a.l) * k,
  };
}

/**
 * Distance a gradient takes to travel from one stop to the other, in CSS px.
 *
 * Proportional to the brush so a fine pen and a fat one both show the shift
 * over a comparable visual run, then clamped so neither extreme is silly.
 */
export function gradientSpan(size: number): number {
  return clamp(size * 26, 120, 700);
}

/**
 * How far between the two stops the ink is, `distance` px into the stroke.
 *
 * A triangle wave rather than a ramp: the total length of a stroke is not known
 * while it is being drawn, and easing back and forth makes a long stroke read
 * as a ribbon instead of clamping to the second stop and staying there.
 */
export function blendAt(distance: number, span: number): number {
  if (span <= 0) return 0;
  const u = Math.abs(distance / span) % 2;
  return u <= 1 ? u : 2 - u;
}

/** The ink colour `distance` px into a stroke drawn at `size`. */
export function colorAt(color: NeonColor, distance: number, size: number): Hsl {
  if (!color.hsl2) return color.hsl;
  return mixHsl(color.hsl, color.hsl2, blendAt(distance, gradientSpan(size)));
}

/**
 * Brush width for one sample. Pen input uses pressure; everything else tapers
 * with speed so mouse and finger strokes still feel alive.
 */
export function sampleWidth(
  size: number,
  pressure: number,
  speed: number,
  isPen: boolean,
): number {
  const factor = isPen
    ? 0.35 + 0.65 * clamp(pressure, 0, 1)
    : 1 - 0.4 * clamp(speed / 3.5, 0, 1);
  return Math.max(0.5, size * factor);
}

/** Minimum distance in CSS px between two recorded samples. */
export const MIN_SAMPLE_DISTANCE = 1.1;

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** `neon-2026-09-14-1430.png` - stable, sortable, filesystem safe. */
export function exportFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-");
  return `neon-${stamp}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
}

export const DEFAULT_BRUSH: Brush = {
  styleId: DEFAULT_STYLE_ID,
  colorId: DEFAULT_COLOR_ID,
  size: DEFAULT_SIZE,
};

/** Never trust stored or user-supplied values - normalise back to known ones. */
export function normaliseBrush(value: unknown): Brush {
  if (typeof value !== "object" || value === null) return DEFAULT_BRUSH;
  const raw = value as Record<string, unknown>;
  const size = Number(raw.size);
  return {
    styleId: findStyle(String(raw.styleId ?? "")).id,
    colorId: findColor(String(raw.colorId ?? "")).id,
    size: Number.isFinite(size)
      ? clamp(Math.round(size), MIN_SIZE, MAX_SIZE)
      : DEFAULT_SIZE,
  };
}
