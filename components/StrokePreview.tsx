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
 * Miniature of a style, built from the same tube/core/bloom recipe the canvas
 * uses so the swatch always matches what the brush will actually draw.
 */
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
            opacity={Math.min(1, pass.alpha * 1.7)}
            style={{ filter: pass.blur > 0 ? `blur(${pass.blur * size * 0.4}px)` : undefined }}
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
