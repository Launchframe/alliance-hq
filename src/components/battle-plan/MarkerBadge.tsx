import type { BattlePlanMarkerNumber } from "@/lib/battle-plan/types.shared";

type Props = {
  markerNumber: BattlePlanMarkerNumber;
  colorHex: string;
  size?: "sm" | "md";
};

export function MarkerBadge({ markerNumber, colorHex, size = "md" }: Props) {
  const dimension = size === "sm" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dimension}`}
      style={{ backgroundColor: colorHex }}
      aria-hidden
    >
      {markerNumber}
    </span>
  );
}
