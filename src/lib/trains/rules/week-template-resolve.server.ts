import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getWeekSchedule } from "@/lib/trains/repository";
import { parseTemplateWeekRules } from "@/lib/trains/rules/template-days.shared";
import { PRESET_WEEK_RULES } from "@/lib/trains/rules/presets.shared";
import { scheduleWeekStart } from "@/lib/trains/train-week-calendar.shared";
import type {
  WeekFillTemplate,
  WeekFillTemplateResolver,
} from "@/lib/trains/week-schedule-day-configs.shared";

/**
 * Which template fills the unpainted days of a week.
 *
 * A week with no schedule row has no template, so its days are free choice
 * rather than silently inheriting a preset. That is deliberate: "no rule" is
 * a real state now, and inventing one here is what used to make an unpainted
 * week look like VS Push that nobody chose.
 */

const CUSTOM_FALLBACK: WeekFillTemplate = {
  id: null,
  days: PRESET_WEEK_RULES.custom,
};

/** Small per-request cache — a month view resolves the same few templates. */
type TemplateCache = Map<string, WeekFillTemplate>;

export function createWeekTemplateCache(): TemplateCache {
  return new Map();
}

export async function loadWeekFillTemplateById(
  templateId: string | null,
  cache?: TemplateCache,
): Promise<WeekFillTemplate> {
  if (!templateId) return CUSTOM_FALLBACK;
  const cached = cache?.get(templateId);
  if (cached) return cached;

  const [row] = await getDb()
    .select({ days: schema.trainRuleTemplates.days })
    .from(schema.trainRuleTemplates)
    .where(eq(schema.trainRuleTemplates.id, templateId))
    .limit(1);

  // An archived or deleted template still resolves — days painted from it
  // keep their rules, and the fill falls back to free choice.
  const resolved: WeekFillTemplate = row
    ? { id: templateId, days: parseTemplateWeekRules(row.days) }
    : CUSTOM_FALLBACK;
  cache?.set(templateId, resolved);
  return resolved;
}

export async function resolveWeekFillTemplate(
  allianceId: string,
  weekStart: string,
  seasonKey?: string | null,
  cache?: TemplateCache,
): Promise<WeekFillTemplate> {
  const schedule = await getWeekSchedule(allianceId, weekStart, seasonKey);
  return loadWeekFillTemplateById(schedule?.templateId ?? null, cache);
}

/**
 * Per-date template resolver for a span of dates.
 *
 * Schedule rows are keyed by the Monday calendar week, so a display week that
 * starts on any other day straddles two rows. Resolving per date keeps each
 * tile on its own week's template instead of borrowing the neighbour's.
 */
export async function resolveWeekFillTemplateResolver(
  allianceId: string,
  dates: readonly string[],
  seasonKey?: string | null,
  cache?: TemplateCache,
): Promise<WeekFillTemplateResolver> {
  const byMonday = new Map<string, WeekFillTemplate>();
  for (const monday of new Set(dates.map((date) => scheduleWeekStart(date)))) {
    byMonday.set(
      monday,
      await resolveWeekFillTemplate(allianceId, monday, seasonKey, cache),
    );
  }
  return (date) => byMonday.get(scheduleWeekStart(date)) ?? CUSTOM_FALLBACK;
}
