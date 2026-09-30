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

const recoveryMessages = {
  stale: "stale", expired: "stale", reconnect: "status.reconnect", uncertain: "status.uncertain",
  busy: "busy", rate_limit: "busy", account_change: "accountChange", offline_access_required: "offlineAccessRequired",
  invalid_identity: "identityFailed", missing_scope: "calendarPermissionRequired", invalid_preferences: "invalidPreferences",
} as const;

export function calendarRecoveryMessage(body: unknown, status?: number): string {
  const code = body && typeof body === "object" && "code" in body ? body.code : null;
  return typeof code === "string" && Object.hasOwn(recoveryMessages, code) ? recoveryMessages[code as keyof typeof recoveryMessages] : status === 409 ? "stale" : "failed";
}

export function calendarOAuthFailureCode(error: unknown): string {
  return error instanceof CalendarError && Object.hasOwn(recoveryMessages, error.code) ? error.code : "failed";
}

export function calendarEventPath(path: string, locale: string): string {
  return `${locale === "pt-BR" ? "/pt-BR" : ""}${path}`;
}
