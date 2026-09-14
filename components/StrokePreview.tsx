import { type Hsl, type NeonStyle, hueOffsetAt, inkColor } from "@/lib/neon";

type StrokePreviewProps = {
  style: NeonStyle;
  hsl: Hsl;
  /** Base stroke width in SVG units. */
  size?: number;
  className?: string;
};

const PATH = "M5 22 C 14 6, 26 30, 39 11";
const MID = 22;

/**
 * SVG blending is `screen`, not the additive `lighter` the canvas uses, and the
 * soft core pass is omitted, so these two constants bring the swatch back to
 * roughly what the brush draws. It reads the same recipe from `neon.ts`, but it
 * is an approximation of the render, not a copy of it.
 */
const SCREEN_ALPHA_BOOST = 1.7;
const SCREEN_BLUR_SCALE = 0.4;

/** Miniature of a style, for the picker. */
export function StrokePreview({ style, hsl, size = 4.2, className }: StrokePreviewProps) {
  const hue = hueOffsetAt(style, MID);
  const tube = inkColor(hsl, 0, hue);
  const core = inkColor(hsl, style.coreWhite, hue);

  return (
    <svg viewBox="0 0 44 32" className={className} aria-hidden>
      <g style={{ mixBlendMode: "screen" }}>
        {style.bloom.map((pass, index) => (
          <path
            key={index}
            d={PATH}
            fill="none"
            strokeLinecap="round"
            stroke={tube}
            strokeWidth={Math.max(0.4, size * style.tube)}
            opacity={Math.min(1, pass.alpha * SCREEN_ALPHA_BOOST)}
            style={{ filter: pass.blur > 0 ? `blur(${pass.blur * size * SCREEN_BLUR_SCALE}px)` : undefined }}
          />
        ))}
        <path
          d={PATH}
          fill="none"
          strokeLinecap="round"
          stroke={core}
          strokeWidth={Math.max(0.4, size * style.core)}
        />
      </g>
    </svg>
  );
}
