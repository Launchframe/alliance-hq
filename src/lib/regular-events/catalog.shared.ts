export const REGULAR_EVENT_KEYS = [
  "zombie_siege",
  "sky_marshall",
  "glacierdon",
  "marshal_guard",
] as const;

export type RegularEventKey = (typeof REGULAR_EVENT_KEYS)[number];

export const REGULAR_EVENT_LABELS: Record<RegularEventKey, string> = {
  zombie_siege: "Zombie Siege",
  sky_marshall: "Sky Predator",
  glacierdon: "Glacierdon",
  marshal_guard: "Alliance Exercise",
};

/** Events that get officer upload-score inbox reminders after start. */
export const REGULAR_EVENT_UPLOAD_REMINDER_KEYS = [
  "marshal_guard",
  "zombie_siege",
] as const satisfies readonly RegularEventKey[];

export type RegularEventUploadReminderKey =
  (typeof REGULAR_EVENT_UPLOAD_REMINDER_KEYS)[number];

export function isRegularEventUploadReminderKey(
  value: string,
): value is RegularEventUploadReminderKey {
  return (REGULAR_EVENT_UPLOAD_REMINDER_KEYS as readonly string[]).includes(
    value,
  );
}

/** Minutes after scheduled start before the upload-score reminder is due. */
export const REGULAR_EVENT_UPLOAD_REMINDER_DELAY_MINUTES = 30;

export const DEFAULT_ANNOUNCE_LEAD_MINUTES = 60;

export const DEFAULT_EVENT_ANCHOR_TIME_ST = "23:00";

export const ZOMBIE_SIEGE_CANYON_TIME_ST = "23:30";

/** Mon + Thu in server calendar (0=Sun … 6=Sat). */
export const ZOMBIE_SIEGE_DEFAULT_DOWS = [1, 4] as const;

/** Wed. */
export const WEDNESDAY_DOW = 3;

/** Sky Predator / Glacierdon allowed DOWs (Wed–Fri). */
export const SKY_GLACIER_ALLOWED_DOWS = [3, 4, 5] as const;

export const MARSHAL_GUARD_DEFAULT_INTERVAL_DAYS = 2;

export function isRegularEventKey(value: string): value is RegularEventKey {
  return (REGULAR_EVENT_KEYS as readonly string[]).includes(value);
}

export function regularEventLabel(eventKey: string): string {
  if (isRegularEventKey(eventKey)) return REGULAR_EVENT_LABELS[eventKey];
  return eventKey;
}
