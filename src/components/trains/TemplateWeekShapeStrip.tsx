"use client";

import { useTranslations } from "next-intl";

import { conductorRuleLabelKey } from "@/lib/trains/rules/catalog.shared";
import {
  RULE_PALETTE_SWATCHES,
  paletteIdForRule,
  type DayRulePaletteId,
} from "@/lib/trains/rules/palette.shared";
import {
  WEEKDAY_KEYS,
  weekRulesForPreset,
} from "@/lib/trains/rules/presets.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  template: WeekTemplateType;
};

/**
 * Miniature 7-tile week strip + colour legend.
 *
 * Tiles are calendar weekdays (Mon–Sun), so the preview shows the same shape
 * to every alliance — the strip no longer depends on a week start date.
 */
export function TemplateWeekShapeStrip({ template }: Props) {
  const t = useTranslations("trains");

  if (template === "custom") {
    return null;
  }

  const week = weekRulesForPreset(template);
  // Render Mon-first; WEEKDAY_KEYS is indexed by getServerDayOfWeek (Sun = 0).
  const days = [...WEEKDAY_KEYS.slice(1), WEEKDAY_KEYS[0]];

  const legend: { paletteId: DayRulePaletteId; label: string }[] = [];
  const seen = new Set<DayRulePaletteId>();
  for (const day of days) {
    const paletteId = paletteIdForRule(week[day].conductorRule);
    if (seen.has(paletteId)) continue;
    seen.add(paletteId);
    legend.push({
      paletteId,
      label: t(`rules.${conductorRuleLabelKey(week[day].conductorRule)}`),
    });
  }

  return (
    <div data-testid="trains-template-week-shape">
      <div
        className="grid grid-cols-7 gap-1"
        role="img"
        aria-label={t("templatePicker.weekShapeAria")}
      >
        {days.map((day) => {
          const rule = week[day].conductorRule;
          const paletteId = paletteIdForRule(rule);
          const swatch =
            RULE_PALETTE_SWATCHES[paletteId]?.swatch ?? "bg-slate-500";
          const title = t(`rules.${conductorRuleLabelKey(rule)}`);
          return (
            <div key={day} className="flex flex-col items-center gap-1">
              <div className={`h-6 w-full rounded-md ${swatch}`} title={title} />
              <span className="text-[9px] font-medium uppercase tracking-wide text-hq-fg-muted">
                {t(`weekdays.${day}`)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {legend.map(({ paletteId, label }) => (
          <span
            key={paletteId}
            className="flex items-center gap-1.5 text-[11px] text-hq-fg-muted"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-sm ${
                RULE_PALETTE_SWATCHES[paletteId]?.swatch ?? "bg-slate-500"
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
