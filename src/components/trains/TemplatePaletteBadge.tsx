import { TEMPLATE_PALETTE_STYLES } from "@/lib/trains/mechanism-styles";
import type { WeekTemplateType } from "@/lib/trains/types";

type BadgeProps = {
  template: WeekTemplateType;
  shape?: "circle" | "square";
  className?: string;
};

export function TemplatePaletteBadge({
  template,
  shape = "circle",
  className = "",
}: BadgeProps) {
  const swatch = TEMPLATE_PALETTE_STYLES[template]?.swatch ?? "bg-slate-500";
  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-sm";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 ${shapeClass} ${swatch} ${className}`}
      aria-hidden
    />
  );
}

export function TemplatePaletteOptionLabel({
  template,
  label,
}: {
  template: WeekTemplateType;
  label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TemplatePaletteBadge template={template} />
      <span className="truncate">{label}</span>
    </span>
  );
}
