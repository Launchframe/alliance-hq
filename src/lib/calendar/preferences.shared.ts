import { isPlanZone } from "@/lib/plunder-plan/schedule.shared";
import { CALENDAR_SOURCES, CalendarError, type CalendarPreferences, type CalendarSource } from "./types.shared";

export function parseCalendarPreferences(input: unknown): CalendarPreferences {
  if (!input || typeof input !== "object") throw new CalendarError("invalid_preferences");
  const { alerts, locale, timezone } = input as CalendarPreferences;
  if (!Array.isArray(alerts) || alerts.length > 5 || new Set(alerts).size !== alerts.length || alerts.some((offset) => !Number.isInteger(offset) || offset < 1 || offset > 40320) || (locale !== "en-US" && locale !== "pt-BR") || !isPlanZone(timezone)) throw new CalendarError("invalid_preferences");
  return { alerts: [...alerts].sort((a, b) => b - a), locale, timezone };
}

export function parseCalendarSources(input: unknown): CalendarSource[] {
  if (!Array.isArray(input) || input.length > CALENDAR_SOURCES.length || input.some((value) => !CALENDAR_SOURCES.includes(value))) throw new CalendarError("invalid_sources");
  return [...new Set(input)].sort();
}
