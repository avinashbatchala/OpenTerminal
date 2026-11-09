type IconProps = { className?: string };

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function MarketsIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />
      <path d="M3 19h18" />
    </svg>
  );
}

export function ScannerIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3v2m0 14v2M3 12h2m14 0h2" />
    </svg>
  );
}

export function PortfolioIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <path d="M4 7h16v12H4z" />
      <path d="M8 7V5h8v2M4 12h16" />
    </svg>
  );
}

export function ResearchIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <path d="M5 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
      <path d="M17 20h2V6a2 2 0 0 0-2-2M8 8h6M8 12h6M8 16h4" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.38.32.72.6 1 .3.27.68.42 1.1.4H21v4h-.09a1.7 1.7 0 0 0-1.51.6z" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.8 2.8m5.8 5.8 2.8 2.8m0-11.4-2.8 2.8m-5.8 5.8-2.8 2.8" />
    </svg>
  );
}

export function BullIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <path d="M8.2 9.2C5.9 9.2 4.1 7.9 3.4 5.4M15.8 9.2c2.3 0 4.1-1.3 4.8-3.8" />
      <path d="M8.2 9.2c1-1.2 2.3-1.8 3.8-1.8s2.8.6 3.8 1.8c1.2 2 1.3 4.2.7 6.3-.6 2.3-2 4.3-3.4 5.1-.6.3-1.3.5-1.9.5s-1.3-.2-1.9-.5c-1.4-.8-2.8-2.8-3.4-5.1-.6-2.1-.5-4.3.7-6.3Z" />
      <circle cx="9.7" cy="12.2" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.3" cy="12.2" r=".9" fill="currentColor" stroke="none" />
      <path d="M9.6 17.2h4.8M11 17.2v1.4M13 17.2v1.4" />
    </svg>
  );
}

export function BearIcon({ className }: IconProps) {
  return (
    <svg {...base} aria-hidden="true" className={className}>
      <circle cx="7.2" cy="8" r="1.8" />
      <circle cx="16.8" cy="8" r="1.8" />
      <path d="M7.2 9.7c-1.2 1.4-1.8 3.2-1.5 4.9.3 2.1 1.2 3.8 2.5 4.9 1 .8 2.4 1.3 3.8 1.3s2.8-.5 3.8-1.3c1.3-1.1 2.2-2.8 2.5-4.9.3-1.7-.3-3.5-1.5-4.9-1.3.9-2.9 1.4-4.8 1.4s-3.5-.5-4.8-1.4Z" />
      <ellipse cx="12" cy="15.2" rx="2.4" ry="1.7" />
      <circle cx="9.8" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="12" r=".8" fill="currentColor" stroke="none" />
      <path d="M12 15.2v.9M11 16.4c.4.4 1.6.4 2 0" />
    </svg>
  );
}
