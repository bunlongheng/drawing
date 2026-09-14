import { describe, expect, it } from "vitest";
import {
  COLORS,
  DEFAULT_BRUSH,
  MAX_SIZE,
  MIN_SIZE,
  STYLES,
  clamp,
  distance,
  exportFilename,
  findColor,
  findStyle,
  hueOffsetAt,
  inkColor,
  normaliseBrush,
  sampleWidth,
  wrapHue,
} from "../lib/neon";

describe("presets", () => {
  it("exposes unique style and colour ids", () => {
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    expect(new Set(COLORS.map((c) => c.id)).size).toBe(COLORS.length);
  });

  it("falls back to the first preset for unknown ids", () => {
    expect(findStyle("nope").id).toBe(STYLES[0].id);
    expect(findColor("nope").id).toBe(COLORS[0].id);
    expect(findStyle("laser").id).toBe("laser");
  });

  it("keeps every bloom recipe within a sane range", () => {
    for (const style of STYLES) {
      expect(style.bloom.length).toBeGreaterThan(0);
      expect(style.tube).toBeGreaterThan(0);
      expect(style.core).toBeGreaterThan(0);
      expect(style.core).toBeLessThan(style.tube);
      expect(style.coreWhite).toBeGreaterThanOrEqual(0);
      expect(style.coreWhite).toBeLessThanOrEqual(1);
      for (const pass of style.bloom) {
        expect(pass.blur).toBeGreaterThanOrEqual(0);
        expect(pass.alpha).toBeGreaterThan(0);
        expect(pass.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("includes one sharp pass in every bloom recipe", () => {
    for (const style of STYLES) {
      expect(style.bloom.some((pass) => pass.blur === 0)).toBe(true);
    }
  });
});

describe("colour maths", () => {
  it("wraps hues into a single turn", () => {
    expect(wrapHue(0)).toBe(0);
    expect(wrapHue(360)).toBe(0);
    expect(wrapHue(-30)).toBe(330);
    expect(wrapHue(740)).toBe(20);
  });

  it("mixes toward white by dropping saturation and raising lightness", () => {
    const base = { h: 186, s: 100, l: 50 };
    expect(inkColor(base, 0)).toBe("hsl(186.0 100.0% 50.0%)");
    expect(inkColor(base, 1)).toBe("hsl(186.0 0.0% 100.0%)");
    expect(inkColor(base, 0.5)).toBe("hsl(186.0 50.0% 75.0%)");
  });

  it("clamps out-of-range white mixes", () => {
    const base = { h: 10, s: 80, l: 40 };
    expect(inkColor(base, -2)).toBe(inkColor(base, 0));
    expect(inkColor(base, 9)).toBe(inkColor(base, 1));
  });

  it("rotates the hue along the stroke only for shifting styles", () => {
    expect(hueOffsetAt(findStyle("classic"), 500)).toBe(0);
    expect(hueOffsetAt(findStyle("plasma"), 100)).toBe(45);
    expect(hueOffsetAt(findStyle("plasma"), 200)).toBe(90);
  });

  it("applies the hue offset to the rendered colour", () => {
    expect(inkColor({ h: 350, s: 100, l: 50 }, 0, 20)).toBe("hsl(10.0 100.0% 50.0%)");
  });
});

describe("brush geometry", () => {
  it("scales pen width with pressure", () => {
    expect(sampleWidth(10, 0, 0, true)).toBeCloseTo(3.5);
    expect(sampleWidth(10, 1, 0, true)).toBeCloseTo(10);
    expect(sampleWidth(10, 0.5, 0, true)).toBeCloseTo(6.75);
  });

  it("clamps pressure coming from misbehaving devices", () => {
    expect(sampleWidth(10, -1, 0, true)).toBeCloseTo(3.5);
    expect(sampleWidth(10, 4, 0, true)).toBeCloseTo(10);
  });

  it("tapers non-pen strokes with speed instead of pressure", () => {
    expect(sampleWidth(10, 0, 0, false)).toBeCloseTo(10);
    expect(sampleWidth(10, 0, 99, false)).toBeCloseTo(6);
  });

  it("never returns a zero or negative width", () => {
    expect(sampleWidth(0, 0, 99, false)).toBeGreaterThan(0);
  });

  it("measures distance between samples", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(2, 2, 2, 2)).toBe(0);
  });

  it("clamps", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("normaliseBrush", () => {
  it("passes through a valid brush", () => {
    const brush = { styleId: "laser", colorId: "rose", size: 20 };
    expect(normaliseBrush(brush)).toEqual(brush);
  });

  it("replaces unknown ids and non-numeric sizes", () => {
    expect(normaliseBrush({ styleId: "<script>", colorId: 42, size: "big" })).toEqual(
      DEFAULT_BRUSH,
    );
  });

  it("clamps and rounds the size", () => {
    expect(normaliseBrush({ size: 9999 }).size).toBe(MAX_SIZE);
    expect(normaliseBrush({ size: -10 }).size).toBe(MIN_SIZE);
    expect(normaliseBrush({ size: 12.7 }).size).toBe(13);
  });

  it("survives junk input", () => {
    for (const junk of [null, undefined, 7, "brush", [], true]) {
      expect(normaliseBrush(junk)).toEqual(DEFAULT_BRUSH);
    }
  });
});

describe("exportFilename", () => {
  it("builds a sortable, filesystem-safe name", () => {
    expect(exportFilename(new Date(2026, 8, 14, 9, 5, 3))).toBe("neon-2026-09-14-090503.png");
  });

  it("contains no path separators", () => {
    expect(exportFilename()).toMatch(/^neon-[\d-]+\.png$/);
  });
});
