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

/** The largest brush a swatch uses; wide styles scale down from here. */
const MAX_SIZE = 2.3;

/**
 * A brush size whose widest blurred pass still fits the tile.
 *
 * Halo's bloom reaches five times the brush width, so one fixed size would clip
 * it against the canvas edge and leave a bright rectangle. Scaling per style
 * keeps every swatch whole while Halo stays visibly the fattest.
 */
function previewSize(style: NeonStyle, height: number): number {
  const widest = Math.max(0, ...style.bloom.map((pass) => pass.blur));
  if (widest === 0) return MAX_SIZE;
  return Math.min(MAX_SIZE, Math.max(1.4, height / 2 / (widest * 2.2)));
}

/** The squiggle, as samples rather than a path, because that is what the engine takes. */
function curve(width: number, height: number) {
  const inset = Math.min(width, height) * 0.3;
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
  width = 50,
  height = 36,
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
    const brush = { styleId: style.id, colorId, size: previewSize(style, height) };
    engine.begin(brush, points[0].x, points[0].y, 1, true);
    for (const point of points.slice(1)) engine.extend(point.x, point.y, 1, true);
    engine.end();

    return () => engine.destroy();
  }, [style, colorId, width, height]);

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
