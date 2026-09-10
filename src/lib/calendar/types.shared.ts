export const CALENDAR_SOURCES = ["regular", "battle", "boarding", "plunder", "teams", "timeOff"] as const;
export type CalendarSource = typeof CALENDAR_SOURCES[number];
export type CalendarPreferences = { alerts: number[]; locale: "en-US" | "pt-BR"; timezone: string };
export type CalendarEvent = { key: string; source: CalendarSource; title: string; description: string; path: string; allDay: boolean; start: string; end: string; alerts: number[] };
export class CalendarError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
