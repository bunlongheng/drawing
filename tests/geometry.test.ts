import { describe, expect, it } from "vitest";
import {
  BLOOM_SIGMA,
  bloomPad,
  damageRect,
  emptyBounds,
  expandRect,
  growBounds,
  isEmpty,
  unionRect,
  type Bounds,
} from "../lib/geometry";
import { findStyle } from "../lib/neon";

const bounds = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("bounds", () => {
  it("starts empty", () => {
    expect(isEmpty(emptyBounds())).toBe(true);
  });

  it("grows around each point by its reach", () => {
    const b = emptyBounds();
    growBounds(b, 50, 50, 5);
    expect(b).toEqual(bounds(45, 45, 55, 55));
    growBounds(b, 10, 90, 2);
    expect(b).toEqual(bounds(8, 45, 55, 92));
    expect(isEmpty(b)).toBe(false);
  });
});

describe("unionRect", () => {
  it("returns the other side when one is null", () => {
    const r = { x: 1, y: 2, w: 3, h: 4 };
    expect(unionRect(null, r)).toBe(r);
    expect(unionRect(r, null)).toBe(r);
    expect(unionRect(null, null)).toBeNull();
  });

  it("covers both rects", () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 30 })).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 35,
    });
  });
});

describe("bloomPad", () => {
  it("scales with the widest blur, the brush size and the pixel ratio", () => {
    const classic = findStyle("classic");
    // Derived, not hardcoded, so tuning a preset does not break this.
    const widest = Math.max(...classic.bloom.map((pass) => pass.blur));
    expect(bloomPad(classic, 10, 1)).toBeCloseTo(widest * 10 * BLOOM_SIGMA + 2);
    expect(bloomPad(classic, 10, 2)).toBeCloseTo(widest * 10 * BLOOM_SIGMA * 2 + 2);
  });

  it("grows monotonically with size", () => {
    const style = findStyle("halo");
    let previous = 0;
    for (const size of [2, 8, 16, 32, 48]) {
      const pad = bloomPad(style, size, 2);
      expect(pad).toBeGreaterThan(previous);
      previous = pad;
    }
  });

  it("is never negative, even for a style with no blur", () => {
    expect(bloomPad({ ...findStyle("wire"), bloom: [{ blur: 0, alpha: 1 }] }, 10, 2)).toBe(2);
  });
});

describe("damageRect", () => {
  it("returns null for empty bounds", () => {
    expect(damageRect(emptyBounds(), 10, 1, 500, 500)).toBeNull();
  });

  it("pads the bounds and scales them into device pixels", () => {
    expect(damageRect(bounds(100, 100, 200, 200), 10, 2, 1000, 1000)).toEqual({
      x: 190,
      y: 190,
      w: 220,
      h: 220,
    });
  });

  it("clamps to the canvas instead of running off it", () => {
    const rect = damageRect(bounds(-50, -50, 40, 40), 20, 1, 100, 100)!;
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(100);
    expect(rect.y + rect.h).toBeLessThanOrEqual(100);
  });

  it("returns null when the padded bounds land entirely off-canvas", () => {
    expect(damageRect(bounds(-500, -500, -400, -400), 5, 1, 100, 100)).toBeNull();
    expect(damageRect(bounds(900, 900, 950, 950), 5, 1, 100, 100)).toBeNull();
  });

  it("always covers the whole painted extent", () => {
    const b = bounds(37.4, 12.1, 88.9, 61.7);
    const dpr = 2;
    const rect = damageRect(b, 6, dpr, 1000, 1000)!;
    expect(rect.x).toBeLessThanOrEqual(b.minX * dpr);
    expect(rect.y).toBeLessThanOrEqual(b.minY * dpr);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(b.maxX * dpr);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(b.maxY * dpr);
  });
});

describe("expandRect", () => {
  it("grows on every side and clamps to the canvas", () => {
    expect(expandRect({ x: 50, y: 50, w: 20, h: 20 }, 10, 1000, 1000)).toEqual({
      x: 40,
      y: 40,
      w: 40,
      h: 40,
    });
    const clamped = expandRect({ x: 5, y: 5, w: 20, h: 20 }, 50, 100, 100);
    expect(clamped).toEqual({ x: 0, y: 0, w: 75, h: 75 });
  });

  it("shrinks on a negative pad without inverting", () => {
    const rect = expandRect({ x: 100, y: 100, w: 200, h: 200 }, -20, 1000, 1000);
    expect(rect.w).toBeLessThan(200);
    expect(rect.w).toBeGreaterThan(0);
  });
});
