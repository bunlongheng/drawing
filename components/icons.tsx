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

export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3.2v3M10 13.8v3M3.2 10h3M13.8 10h3" />
      <path d="M6.8 6.8 8 8M12 12l1.2 1.2M13.2 6.8 12 8M8 12l-1.2 1.2" />
      <circle cx="10" cy="10" r="1.8" />
    </svg>
  );
}

export function OffIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="10" r="6.2" />
      <path d="M5.6 14.4 14.4 5.6" />
    </svg>
  );
}

export function BreatheIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="10" r="2" />
      <path d="M13.6 6.4a5 5 0 0 1 0 7.2M6.4 13.6a5 5 0 0 1 0-7.2" />
      <path d="M16 4a8.5 8.5 0 0 1 0 12M4 16A8.5 8.5 0 0 1 4 4" opacity=".5" />
    </svg>
  );
}

export function FlickerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M11 2.6 5.4 11h3.8l-1 6.4L14 9h-3.8z" />
    </svg>
  );
}

export function FireflyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="6" cy="13" r="1.9" />
      <circle cx="13.4" cy="7.2" r="1.4" />
      <circle cx="14.6" cy="14" r="1" />
      <path d="M7.6 11.2c1-1.4 2.2-2.4 3.6-3" opacity=".5" />
    </svg>
  );
}

export function FlowIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.6 12.4c2.4 0 3.2-4.8 5.6-4.8s3.2 4.8 5.6 4.8" />
      <path d="M14.4 12.4h2.8" />
      <path d="M15.4 10.6 17.4 12.4 15.4 14.2" />
    </svg>
  );
}

export function VideoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.6" y="5" width="10.4" height="10" rx="2" />
      <path d="M13 9.4 17.4 6.8v6.4L13 10.6z" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.6" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l8 8M14 6l-8 8" />
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
