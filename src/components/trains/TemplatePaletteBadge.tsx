import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  RULE_PALETTE_SWATCHES,
  paletteIdForRule,
  type DayRulePaletteId,
} from "@/lib/trains/rules/palette.shared";

type BadgeProps = {
  paletteId: DayRulePaletteId;
  shape?: "circle" | "square";
  className?: string;
};

export function RulePaletteBadge({
  paletteId,
  shape = "circle",
  className = "",
}: BadgeProps) {
  const swatch = RULE_PALETTE_SWATCHES[paletteId]?.swatch ?? "bg-slate-500";
  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-sm";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 ${shapeClass} ${swatch} ${className}`}
      aria-hidden
    />
  );
}

export function RuleBadgeForRule({
  rule,
  shape = "circle",
  className = "",
}: {
  rule: ConductorRule | null;
} & Omit<BadgeProps, "paletteId">) {
  return (
    <RulePaletteBadge
      paletteId={paletteIdForRule(rule)}
      shape={shape}
      className={className}
    />
  );
}

export function RulePaletteOptionLabel({
  paletteId,
  label,
}: {
  paletteId: DayRulePaletteId;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <RulePaletteBadge paletteId={paletteId} />
      <span className="truncate">{label}</span>
    </span>
  );
}
