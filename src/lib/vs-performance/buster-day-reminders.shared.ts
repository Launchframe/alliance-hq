import { SERVER_TIME_IANA } from "@/lib/timezone/constants";
import {
  formatServerCalendarDate,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";

/** Reminder kind for a Buster Day snapshot window. */
export type BusterDayReminderKind = "pre" | "post";

/** Friday 20:00 ST — upload power + kills before the fight. */
export const BUSTER_DAY_PRE_REMINDER_HOUR_ST = 20;

/** Sunday 00:00 ST — upload post-fight snapshots. */
export const BUSTER_DAY_POST_REMINDER_HOUR_ST = 0;

/** Hour of day 0–23 in game Server Time. */
export function getServerHourOfDay(now = new Date()): number {
  const raw = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SERVER_TIME_IANA,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  // Some ICU builds emit "24" for midnight with hour12:false.
  if (raw === 24) return 0;
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Which reminder (if any) should fire for this instant in Server Time.
 * Cron runs every 15m; the matching hour window (e.g. Fri 20:00–20:59) is the
 * fire window. Idempotency is enforced via `*_reminder_sent_at` on the report.
 */
export function resolveBusterDayReminderKind(
  now = new Date(),
): BusterDayReminderKind | null {
  const dateStr = formatServerCalendarDate(now);
  const dow = getServerDayOfWeek(dateStr);
  const hour = getServerHourOfDay(now);

  if (dow === 5 && hour === BUSTER_DAY_PRE_REMINDER_HOUR_ST) return "pre";
  if (dow === 0 && hour === BUSTER_DAY_POST_REMINDER_HOUR_ST) return "post";
  return null;
}

export function buildBusterDayReminderDiscordMessage(input: {
  kind: BusterDayReminderKind;
  allianceTag: string;
  wizardUrl: string;
}): string {
  if (input.kind === "pre") {
    return [
      `**Buster Day — pre-fight snapshots** (${input.allianceTag})`,
      "",
      "Upload tonight's alliance roster (power) and kills leaderboard before Saturday's fight.",
      `Open the wizard: ${input.wizardUrl}`,
    ].join("\n");
  }
  return [
    `**Buster Day — post-fight snapshots** (${input.allianceTag})`,
    "",
    "Upload today's alliance roster (power) and kills leaderboard to unlock the efficiency report.",
    `Open the wizard: ${input.wizardUrl}`,
  ].join("\n");
}

export function buildBusterDayReminderEmail(input: {
  kind: BusterDayReminderKind;
  allianceTag: string;
  wizardUrl: string;
}): { subject: string; text: string; html: string } {
  const isPre = input.kind === "pre";
  const subject = isPre
    ? `Buster Day: upload pre-fight snapshots (${input.allianceTag})`
    : `Buster Day: upload post-fight snapshots (${input.allianceTag})`;
  const body = isPre
    ? "Upload tonight's alliance roster (power) and kills leaderboard before Saturday's fight so HQ can measure Buster Day efficiency."
    : "Upload today's alliance roster (power) and kills leaderboard after the fight so HQ can build the efficiency report.";
  const text = [
    subject,
    "",
    body,
    "",
    `Open the wizard: ${input.wizardUrl}`,
    "",
    "— Alliance HQ",
  ].join("\n");
  const safeTag = escapeHtml(input.allianceTag);
  const safeUrl = escapeHtml(input.wizardUrl);
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;">${isPre ? "Buster Day — pre-fight" : "Buster Day — post-fight"}</h2>
  <p style="margin:0 0 12px;color:#374151;">${body}</p>
  <p style="margin:0 0 16px;">
    <a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
      Open Buster Day wizard
    </a>
  </p>
  <p style="margin:0;font-size:12px;color:#9ca3af;">— Alliance HQ · ${safeTag}</p>
</div>`.trim();
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
