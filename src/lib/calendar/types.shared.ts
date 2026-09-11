export const CALENDAR_SOURCES = ["regular", "battle", "boarding", "plunder", "teams", "timeOff"] as const;
export type CalendarSource = typeof CALENDAR_SOURCES[number];
export type CalendarPreferences = { alerts: number[]; locale: "en-US" | "pt-BR"; timezone: string };
export type CalendarEvent = { key: string; source: CalendarSource; title: string; description: string; path: string; locale?: "en-US" | "pt-BR"; allDay: boolean; start: string; end: string; alerts: number[] };
export type CalendarSettingsData = {
  preferences: CalendarPreferences & { version: number };
  alliances: Array<{ id: string; tag: string | null; name: string; sources: CalendarSource[] }>;
  targets: Array<{ id: string; allianceId: string; provider: string; sources: CalendarSource[]; enabled: boolean; version: number; status: string; cleanup: boolean; creationUncertain: boolean; lastSyncAt: string | null; lastFetchAt: string | null }>;
  account: { email: string; status: string; version: number } | null;
  googleAvailable: boolean;
};
export class CalendarError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
