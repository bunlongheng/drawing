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

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7.5 4.5 15 10l-7.5 5.5z" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3.2v3M10 13.8v3M3.2 10h3M13.8 10h3" />
      <path d="M6.8 6.8 8 8M12 12l1.2 1.2M13.2 6.8 12 8M8 12l-1.2 1.2" />
      <circle cx="10" cy="10" r="1.8" />
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
