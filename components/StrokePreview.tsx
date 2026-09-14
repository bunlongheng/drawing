"use client";

import { useEffect, useRef } from "react";
import { NeonEngine } from "@/lib/engine";
import type { NeonStyle } from "@/lib/neon";

type StrokePreviewProps = {
  style: NeonStyle;
  colorId: string;
  /** Tile size in CSS px. The trigger is smaller than the picker swatches. */
  width?: number;
  height?: number;
};

/** A brush size that reads at this scale; the recipe is proportional to it. */
const SIZE = 3.6;

/** The squiggle, as samples rather than a path, because that is what the engine takes. */
function curve(width: number, height: number) {
  const inset = 8;
  return Array.from({ length: 26 }, (_, i) => {
    const t = i / 25;
    return {
      x: inset + t * (width - inset * 2),
      y: height / 2 + Math.sin(t * Math.PI * 2) * (height / 2 - inset),
    };
  });
}

/**
 * Miniature of a style, drawn by the real engine on a small canvas.
 *
 * An SVG lookalike needs `screen` blending and fudge factors to stand in for
 * the additive bloom, and then drifts whenever a preset changes. Running the
 * actual renderer means the swatch cannot disagree with the brush.
 */
export function StrokePreview({
  style,
  colorId,
  width = 44,
  height = 30,
}: StrokePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let engine: NeonEngine;
    try {
      engine = new NeonEngine(canvas, () => {});
    } catch {
      return; // No 2D context: the picker degrades to an empty tile.
    }
    engine.resize(width, height, window.devicePixelRatio);

    const points = curve(width, height);
    const brush = { styleId: style.id, colorId, size: SIZE };
    engine.begin(brush, points[0].x, points[0].y, 1, true);
    for (const point of points.slice(1)) engine.extend(point.x, point.y, 1, true);
    engine.end();

    return () => engine.destroy();
  }, [style.id, colorId, width, height]);

  return (
    <canvas
      ref={ref}
      // The engine always paints its own black ground; `screen` drops it back
      // to the panel so the swatch reads as ink, not as a black tile.
      style={{ width, height, mixBlendMode: "screen" }}
      aria-hidden
    />
  );
}
