import { MarkerIcon } from "@/components/battle-plan/MarkerIcon";
import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";

type Props = {
  iconPreset: MarkerIconPreset;
  size?: "sm" | "md";
  className?: string;
};

export function MarkerBadge({ iconPreset, size = "md", className = "" }: Props) {
  const dimension = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${dimension} ${className}`}
      aria-hidden
    >
      <MarkerIcon preset={iconPreset} className="h-full w-full" />
    </span>
  );
}
