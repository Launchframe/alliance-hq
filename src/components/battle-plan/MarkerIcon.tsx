import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";

type Props = {
  preset: MarkerIconPreset;
  className?: string;
};

const ORDINAL_TEXT: Record<
  Extract<
    MarkerIconPreset,
    "ordinal-1" | "ordinal-2" | "ordinal-3" | "ordinal-4" | "ordinal-5"
  >,
  string
> = {
  "ordinal-1": "1st",
  "ordinal-2": "2nd",
  "ordinal-3": "3rd",
  "ordinal-4": "4th",
  "ordinal-5": "5th",
};

function OrdinalMarker({
  preset,
  className,
}: {
  preset: keyof typeof ORDINAL_TEXT;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      role="img"
    >
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fill="#38bdf8"
        fontSize="11"
        fontStyle="italic"
        fontWeight="600"
        fontFamily="Georgia, 'Times New Roman', serif"
      >
        {ORDINAL_TEXT[preset]}
      </text>
    </svg>
  );
}

export function MarkerIcon({ preset, className }: Props) {
  if (preset.startsWith("ordinal-")) {
    return (
      <OrdinalMarker
        preset={preset as keyof typeof ORDINAL_TEXT}
        className={className}
      />
    );
  }

  switch (preset) {
    case "crossed-swords":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <g fill="#dc2626" stroke="#dc2626" strokeLinecap="round">
            <path
              d="M16 3 18.5 8.5 14 13"
              strokeWidth="2.5"
              fill="none"
            />
            <path d="M18.5 8.5 21 7 19 4.5Z" />
            <path
              d="M8 21 5.5 15.5 10 11"
              strokeWidth="2.5"
              fill="none"
            />
            <path d="M5.5 15.5 3 17 5 19.5Z" />
          </g>
        </svg>
      );
    case "hammer":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <rect x="14" y="4" width="7" height="4.5" rx="0.75" fill="#f97316" />
          <rect x="12.5" y="7" width="4" height="3" rx="0.5" fill="#f97316" />
          <rect
            x="5"
            y="15"
            width="13"
            height="3"
            rx="1"
            fill="#f97316"
            transform="rotate(-38 11.5 16.5)"
          />
        </svg>
      );
    case "sun":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <circle cx="12" cy="12" r="4.5" fill="#facc15" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <rect
              key={angle}
              x="11"
              y="2"
              width="2"
              height="4"
              rx="1"
              fill="#facc15"
              transform={`rotate(${angle} 12 12)`}
            />
          ))}
        </svg>
      );
    case "star-4":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path
            d="M12 2 14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5Z"
            fill="#facc15"
          />
        </svg>
      );
    case "clover":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <circle cx="8" cy="8" r="3.5" fill="#22c55e" />
          <circle cx="16" cy="8" r="3.5" fill="#22c55e" />
          <circle cx="8" cy="16" r="3.5" fill="#22c55e" />
          <circle cx="16" cy="16" r="3.5" fill="#22c55e" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path
            d="M12 2 19 5.5V12c0 4.5-3.2 7.8-7 9.5-3.8-1.7-7-5-7-9.5V5.5Z"
            fill="#84cc16"
          />
        </svg>
      );
    case "triangle":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path d="M12 4 21 20H3Z" fill="#2563eb" />
        </svg>
      );
    case "crescent":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path
            d="M17 5.5a7.5 7.5 0 1 0 2.5 14.2A6 6 0 1 1 17 5.5Z"
            fill="#d946ef"
          />
        </svg>
      );
    case "star-5":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path
            d="M12 2.5 14.8 9.2 22 9.7 16.5 14.3 18.2 21.5 12 17.8 5.8 21.5 7.5 14.3 2 9.7 9.2 9.2Z"
            fill="#9333ea"
          />
        </svg>
      );
    case "hexagon":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path
            d="M12 3 19.5 7.5V16.5L12 21 4.5 16.5V7.5Z"
            fill="#ea580c"
          />
        </svg>
      );
    case "square":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <rect x="5" y="5" width="14" height="14" rx="1" fill="#dc2626" />
        </svg>
      );
    case "circle":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <circle cx="12" cy="12" r="8" fill="#92400e" />
        </svg>
      );
    case "parallelogram":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path d="M6.5 5h12.5L16 19H3.5Z" fill="#06b6d4" />
        </svg>
      );
    case "trapezoid":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden role="img">
          <path d="M9 5h6l5.5 14H3.5Z" fill="#16a34a" />
        </svg>
      );
    default:
      return null;
  }
}
