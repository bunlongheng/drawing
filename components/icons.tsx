/** 20px line icons. One shared stroke treatment keeps the bar visually even. */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function UndoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 6H12.5a4 4 0 0 1 0 8H8" />
      <path d="M9.5 3.5 6.5 6l3 2.5" />
    </svg>
  );
}

export function RedoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 6H7.5a4 4 0 0 0 0 8H12" />
      <path d="M10.5 3.5 13.5 6l-3 2.5" />
    </svg>
  );
}

export function ClearIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h12" />
      <path d="M8 6V4.5h4V6" />
      <path d="M6 6l.8 9.5h6.4L14 6" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3v9" />
      <path d="M6.5 9 10 12.5 13.5 9" />
      <path d="M4 15.5h12" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 13V3.5" />
      <path d="M6.5 7 10 3.5 13.5 7" />
      <path d="M5 11v4.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V11" />
    </svg>
  );
}

export function SizeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="6" cy="10" r="1.6" />
      <circle cx="13.5" cy="10" r="4" />
    </svg>
  );
}
