/** Dispatched after inbox reminders are dismissed so the nav badge can refresh. */
export const INBOX_REMINDERS_REFRESH_EVENT = "inbox-reminders:refresh";

export function dispatchInboxRemindersRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INBOX_REMINDERS_REFRESH_EVENT));
}
