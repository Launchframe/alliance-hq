"use client";

import { useTranslations } from "next-intl";

import { getServerDayOfWeek } from "@/lib/trains/game-time";
import { TEMPLATE_PALETTE_STYLES } from "@/lib/trains/mechanism-styles";
import { weekTemplateDayShape } from "@/lib/trains/week-template-registry.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

const WEEKDAY_KEY_BY_DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Props = {
  template: WeekTemplateType;
  /** Any valid train-week start date — only used to resolve the 7-day shape. */
  weekStart: string;
};

/** Miniature 7-tile week strip + color legend, replacing prose "shape of week" copy. */
export function TemplateWeekShapeStrip({ template, weekStart }: Props) {
  const t = useTranslations("trains");

  if (template === "custom") {
    return null;
  }

  const shape = weekTemplateDayShape(template, weekStart);

  const legend: { segment: WeekTemplateType; label: string }[] = [];
  const seen = new Set<WeekTemplateType>();
  for (const { segment } of shape) {
    if (seen.has(segment)) continue;
    seen.add(segment);
    const legendKey = `templateShapeLegend.${segment}` as const;
    legend.push({
      segment,
      label: t.has(legendKey) ? t(legendKey) : t(`templates.${segment}`),
    });
  }

  return (
    <div data-testid="trains-template-week-shape">
      <div
        className="grid grid-cols-7 gap-1"
        role="img"
        aria-label={t("templatePicker.weekShapeAria")}
      >
        {shape.map(({ date, segment }) => {
          const swatch = TEMPLATE_PALETTE_STYLES[segment]?.swatch ?? "bg-slate-500";
          const weekdayKey = WEEKDAY_KEY_BY_DOW[getServerDayOfWeek(date)];
          const legendKey = `templateShapeLegend.${segment}` as const;
          const title = t.has(legendKey)
            ? t(legendKey)
            : t(`templates.${segment}`);
          return (
            <div key={date} className="flex flex-col items-center gap-1">
              <div
                className={`h-6 w-full rounded-md ${swatch}`}
                title={title}
              />
              <span className="text-[9px] font-medium uppercase tracking-wide text-hq-fg-muted">
                {t(`weekdays.${weekdayKey}`)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {legend.map(({ segment, label }) => (
          <span
            key={segment}
            className="flex items-center gap-1.5 text-[11px] text-hq-fg-muted"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-sm ${
                TEMPLATE_PALETTE_STYLES[segment]?.swatch ?? "bg-slate-500"
              }`}
              aria-hidden
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
