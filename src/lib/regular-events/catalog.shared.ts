export const REGULAR_EVENT_KEYS = [
  "zombie_siege",
  "sky_marshall",
  "glacierdon",
  "marshal_guard",
] as const;

export type RegularEventKey = (typeof REGULAR_EVENT_KEYS)[number];

export const REGULAR_EVENT_LABELS: Record<RegularEventKey, string> = {
  zombie_siege: "Zombie Siege",
  sky_marshall: "Sky Marshall",
  glacierdon: "Glacierdon",
  marshal_guard: "Marshal Guard",
};

export const DEFAULT_ANNOUNCE_LEAD_MINUTES = 60;

export const DEFAULT_EVENT_ANCHOR_TIME_ST = "23:00";

export const ZOMBIE_SIEGE_CANYON_TIME_ST = "23:30";

/** Mon + Thu in server calendar (0=Sun … 6=Sat). */
export const ZOMBIE_SIEGE_DEFAULT_DOWS = [1, 4] as const;

/** Wed. */
export const WEDNESDAY_DOW = 3;

export const MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS = 2;

export function isRegularEventKey(value: string): value is RegularEventKey {
  return (REGULAR_EVENT_KEYS as readonly string[]).includes(value);
}

export function regularEventLabel(eventKey: string): string {
  if (isRegularEventKey(eventKey)) return REGULAR_EVENT_LABELS[eventKey];
  return eventKey;
}
