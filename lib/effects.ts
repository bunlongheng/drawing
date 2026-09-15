/**
 * Ambient animation for a finished drawing.
 *
 * Everything here is a pure function of time, so the engine holds no particle
 * state, nothing drifts out of sync after a pause, and the maths can be tested
 * without a canvas.
 */

export type EffectId = "off" | "breathe" | "flicker" | "sparkle" | "firefly" | "flow";

export type Effect = {
  id: EffectId;
  name: string;
  /** One line, shown under the name in the picker. */
  hint: string;
};

export const EFFECTS: Effect[] = [
  { id: "off", name: "Off", hint: "Still" },
  { id: "breathe", name: "Breathe", hint: "Swells and dims" },
  { id: "flicker", name: "Flicker", hint: "An old sign" },
  { id: "sparkle", name: "Sparkle", hint: "Star glints" },
  { id: "firefly", name: "Firefly", hint: "Drifting motes" },
  { id: "flow", name: "Flow", hint: "Current through the tube" },
];

export const DEFAULT_EFFECT_ID: EffectId = "firefly";

export function findEffect(id: string): Effect {
  return EFFECTS.find((effect) => effect.id === id) ?? EFFECTS[0];
}

/** Deterministic pseudo-random in [0, 1), so particles need no stored state. */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const BREATHE_PERIOD = 4.5;

/**
 * Brightness multiplier for the whole artwork at `t` seconds.
 *
 * Only the two envelope effects move it; the particle effects add light rather
 * than modulating what is already there.
 */
export function brightnessAt(id: EffectId, t: number): number {
  if (id === "breathe") {
    return 0.72 + 0.28 * (0.5 + 0.5 * Math.sin((t / BREATHE_PERIOD) * Math.PI * 2));
  }
  if (id === "flicker") {
    // Steady most of the time, with the occasional stutter of a failing tube.
    const tick = Math.floor(t * 9);
    const roll = hash01(tick);
    if (roll > 0.94) return 0.35 + 0.25 * hash01(tick * 7 + 1);
    if (roll > 0.88) return 0.75;
    return 1;
  }
  return 1;
}

/** True when the effect draws particles on top of the artwork. */
export function hasParticles(id: EffectId): boolean {
  return id === "sparkle" || id === "firefly" || id === "flow";
}

export type Particle = {
  /** Where on the artwork it sits, 0 to 1 along everything drawn. */
  at: number;
  /** Fade envelope, 0 to 1. */
  alpha: number;
  /** Radius multiplier. */
  scale: number;
  /** Drift away from the stroke, in CSS px. */
  dx: number;
  dy: number;
  /** Sparkle draws a star on top of its glow; firefly and flow do not. */
  star: boolean;
};

/** Golden ratio, to stagger particles without them clumping. */
const STAGGER = 0.618033988749;

const SPEC: Record<
  string,
  { count: number; life: number; drift: number; star: boolean; radius: number }
> = {
  sparkle: { count: 18, life: 1.7, drift: 0, star: true, radius: 13 },
  firefly: { count: 20, life: 5.4, drift: 46, star: false, radius: 17 },
};

/** Base radius in CSS px for an effect's motes. */
export function moteRadius(id: EffectId): number {
  return SPEC[id]?.radius ?? 18;
}

/**
 * The particles alive at `t` seconds for a spark-style effect.
 *
 * Each one is derived from its index and the cycle it is in, so the set is
 * reproducible at any time without tracking anything between frames.
 */
export function particlesAt(id: EffectId, t: number): Particle[] {
  const spec = SPEC[id];
  if (!spec) return [];

  const out: Particle[] = [];
  for (let i = 0; i < spec.count; i += 1) {
    const offset = i * STAGGER;
    const turns = t / spec.life + offset;
    const cycle = Math.floor(turns);
    const phase = turns - cycle;
    const seed = i * 9973 + cycle * 131;

    // Fade in and out over the life, so nothing pops on or off.
    const alpha = Math.sin(phase * Math.PI);
    const angle = hash01(seed + 3) * Math.PI * 2 + phase * Math.PI * 1.2;
    const reach = spec.drift * (0.35 + 0.65 * hash01(seed + 5));

    out.push({
      at: hash01(seed),
      // Gentle envelope: squaring it left the motes dim for most of their life.
      alpha: alpha * (0.55 + 0.45 * alpha),
      scale: 0.65 + 0.7 * hash01(seed + 1),
      dx: Math.cos(angle) * reach * phase,
      dy: Math.sin(angle) * reach * phase - (spec.drift > 0 ? phase * 14 : 0),
      star: spec.star,
    });
  }
  return out;
}

/**
 * Dust: a cloud of 1px motes that hangs around the bright ones.
 *
 * Same derivation as the big particles, seeded apart so the two clouds do not
 * sit on the same points. They are painted as flat squares, not glows, which
 * is what keeps a hundred of them cheap.
 */
const DUST_COUNT = 110;
const DUST_LIFE = 3.2;
const DUST_DRIFT = 34;

export type Mote = {
  /** Where on the artwork it sits, 0 to 1 along everything drawn. */
  at: number;
  alpha: number;
  dx: number;
  dy: number;
};

export function dustAt(t: number): Mote[] {
  const out: Mote[] = [];
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const turns = t / DUST_LIFE + i * STAGGER;
    const cycle = Math.floor(turns);
    const phase = turns - cycle;
    const seed = i * 7717 + cycle * 197;

    const angle = hash01(seed + 2) * Math.PI * 2;
    const reach = DUST_DRIFT * (0.2 + 0.8 * hash01(seed + 4)) * phase;
    out.push({
      at: hash01(seed + 11),
      alpha: Math.sin(phase * Math.PI) * 0.85,
      dx: Math.cos(angle) * reach,
      dy: Math.sin(angle) * reach - phase * 9,
    });
  }
  return out;
}

/** Seconds a `flow` head takes to travel the whole artwork once. */
const FLOW_PERIOD = 6;
/** How many trailing points follow the head. */
export const FLOW_TRAIL = 14;

/** How much of the artwork the flow dust spreads over, either side of the head. */
export const FLOW_DUST_SPAN = 0.16;

/** Where the travelling head sits at `t` seconds, as 0 to 1 along the artwork. */
export function flowHeadAt(t: number): number {
  const u = (t / FLOW_PERIOD) % 1;
  return u < 0 ? u + 1 : u;
}
