export const CAPTURE_REMINDER_INBOX_KIND = "capture_reminder" as const;

export const CAPTURE_REMINDER_DELAY_MS = 30 * 60 * 1000;

export const CAPTURE_REMINDER_SNOOZE_MS = 30 * 60 * 1000;

export const CAPTURE_REMINDER_SNOOZE_KEY = "hq:capture-reminder-snooze";

export type CaptureReminderSnoozeMap = Record<string, number>;

export function isSnoozed(itemId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(CAPTURE_REMINDER_SNOOZE_KEY);
    if (!raw) return false;
    const map: CaptureReminderSnoozeMap = JSON.parse(raw);
    const until = map[itemId];
    if (!until) return false;
    return Date.now() < until;
  } catch {
    return false;
  }
}

export function snoozeItem(itemId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(CAPTURE_REMINDER_SNOOZE_KEY);
    const map: CaptureReminderSnoozeMap = raw ? JSON.parse(raw) : {};
    map[itemId] = Date.now() + CAPTURE_REMINDER_SNOOZE_MS;
    const now = Date.now();
    for (const key of Object.keys(map)) {
      if (map[key]! < now) delete map[key];
    }
    localStorage.setItem(CAPTURE_REMINDER_SNOOZE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable — snooze is best-effort
  }
}
