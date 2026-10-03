"use client";

import { useTranslations } from "next-intl";

import { conductorRuleLabelKey } from "@/lib/trains/rules/catalog.shared";
import {
  RULE_PALETTE_SWATCHES,
  paletteIdForRule,
  type DayRulePaletteId,
} from "@/lib/trains/rules/palette.shared";
import { WEEKDAY_KEYS } from "@/lib/trains/rules/presets.shared";
import {
  templateWeekRulesForLeadTimePreview,
  type TemplateWeekRules,
} from "@/lib/trains/rules/template-days.shared";

type Props = {
  days: TemplateWeekRules;
  leadDays?: number;
  /** `trains.rules.*` labels, keyed by rule label key. */
  ruleTextLabels: Record<string, string>;
};

/**
 * Miniature 7-tile week strip + colour legend.
 *
 * Tiles remain calendar weekdays (Mon–Sun). Lead time rotates only this
 * preview so officers can see the effective shape without changing the stored
 * template or the dates it paints.
 */
export function TemplateWeekShapeStrip({
  days: templateDays,
  leadDays = 0,
  ruleTextLabels,
}: Props) {
  const week = templateWeekRulesForLeadTimePreview(templateDays, leadDays);
  const t = useTranslations("trains");

  // Render Mon-first; WEEKDAY_KEYS is indexed by getServerDayOfWeek (Sun = 0).
  const days = [...WEEKDAY_KEYS.slice(1), WEEKDAY_KEYS[0]];
  const ruleLabel = (rule: Parameters<typeof paletteIdForRule>[0]) =>
    ruleTextLabels[conductorRuleLabelKey(rule)] ?? paletteIdForRule(rule);

  const legend: { paletteId: DayRulePaletteId; label: string }[] = [];
  const seen = new Set<DayRulePaletteId>();
  for (const day of days) {
    const paletteId = paletteIdForRule(week[day].conductorRule);
    if (seen.has(paletteId)) continue;
    seen.add(paletteId);
    legend.push({
      paletteId,
      label: ruleLabel(week[day].conductorRule),
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
          const title = ruleLabel(rule);
          return (
            <div key={day} className="flex flex-col items-center gap-1">
              <div
                className={`h-6 w-full rounded-md ${swatch}`}
                title={title}
                data-testid={`trains-template-week-shape-${day}`}
                data-rule={paletteId}
              />
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
