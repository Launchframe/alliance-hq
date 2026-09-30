import "server-only";

import { emailPlatformMaintainers } from "@/lib/ops/platform-maintainer-alert.server";

function utcHourFingerprint(now: Date): string {
  // YYYY-MM-DDTHH
  return now.toISOString().slice(0, 13);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email platform maintainers when Last War UID lookup is unreachable.
 * Deduped to at most one email per UTC hour while the outage continues.
 * Never include player UIDs or names.
 */
export async function notifyLastWarUidLookupOutage(input: {
  detail: string;
  now?: Date;
}): Promise<{ sent: boolean }> {
  const now = input.now ?? new Date();
  const envLabel =
    process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const hourKey = utcHourFingerprint(now);
  const subject = `[Alliance HQ] Last War UID lookup failing (${envLabel})`;
  const detail = input.detail.trim().slice(0, 240) || "request_failed";
  const text = [
    "Last War player UID lookup returned request_failed.",
    "",
    `Detail: ${detail}`,
    `Time (UTC): ${now.toISOString()}`,
    `Environment: ${envLabel}`,
    "",
    "Endpoint: POST https://accounts-cdn-api.lastwar.com/api/platform/redemptionCode/login",
    "(override with LASTWAR_PLAYER_LOOKUP_URL if set)",
    "",
    "Impact: open onboarding and Discord /link cannot verify names.",
    "Commander claim invites still fail-open on the honor system.",
    "",
    "Check Admin → UID inspector after verifying the accounts CDN responds.",
    "This alert is sent at most once per UTC hour while lookups keep failing.",
  ].join("\n");
  const html = text
    .split("\n")
    .map((line) => (line === "" ? "<br>" : `<p>${escapeHtml(line)}</p>`))
    .join("");

  const result = await emailPlatformMaintainers({
    subject,
    text,
    html,
    dedupeFingerprint: `lastwar-uid-lookup-outage:${envLabel}:${hourKey}`,
  });
  return { sent: result.sent };
}
