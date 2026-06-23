import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  countSendCodeAttemptsSince,
  emailPlatformMaintainers,
  pruneOldSendCodeAttempts,
} from "@/lib/ops/platform-maintainer-alert.server";
import { getDb, schema } from "@/lib/db";

export const AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN = readPositiveIntEnv(
  "AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN",
  50,
);
export const AUTH_SEND_CODE_GLOBAL_WINDOW_MS = 60 * 1000;

export const AUTH_SEND_CODE_IP_MAX_PER_HOUR = readPositiveIntEnv(
  "AUTH_SEND_CODE_IP_MAX_PER_HOUR",
  10,
);
export const AUTH_SEND_CODE_IP_WINDOW_MS = 60 * 60 * 1000;

export type SendCodeRateLimitScope = "ip" | "global";

export class SendCodeRateLimitError extends Error {
  constructor(
    message: string,
    readonly scope: SendCodeRateLimitScope,
    readonly retryAfterSec: number,
  ) {
    super(message);
    this.name = "SendCodeRateLimitError";
  }
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

export function sendCodeRateLimitsEnabled(): boolean {
  return process.env.E2E_TEST !== "true";
}

function utcMinuteFingerprint(now: Date): string {
  const iso = now.toISOString();
  return iso.slice(0, 16);
}

async function countIpAttemptsSince(ip: string, since: Date): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.authSendCodeAttempts)
    .where(
      and(
        eq(schema.authSendCodeAttempts.clientIp, ip),
        gt(schema.authSendCodeAttempts.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}

async function notifyGlobalCapMaintainers(input: {
  now: Date;
  attemptsInWindow: number;
}): Promise<void> {
  const minuteKey = utcMinuteFingerprint(input.now);
  const envLabel =
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    "unknown";
  const subject = `[Alliance HQ] Auth send-code global cap reached (${envLabel})`;
  const text = [
    "The global rate limit for POST /api/auth/send-code was exceeded.",
    "",
    `Cap: ${AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN} requests per minute`,
    `Attempts in the current window: ${input.attemptsInWindow}`,
    `Time (UTC): ${input.now.toISOString()}`,
    `Environment: ${envLabel}`,
    "",
    "Some sign-in verification emails may have received HTTP 429.",
    "If this traffic is legitimate, raise AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN.",
    "Also review IP limits (AUTH_SEND_CODE_IP_MAX_PER_HOUR) and consider CAPTCHA.",
  ].join("\n");
  const html = text
    .split("\n")
    .map((line) => (line === "" ? "<br>" : `<p>${escapeHtml(line)}</p>`))
    .join("");

  console.error(
    "[send-code-rate-limit] Global cap reached:",
    AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN,
    "per minute;",
    "attempts in window:",
    input.attemptsInWindow,
  );

  await emailPlatformMaintainers({
    subject,
    text,
    html,
    dedupeFingerprint: `send-code-global-cap:${envLabel}:${minuteKey}`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Enforces IP + global send-code caps, records this attempt, and alerts
 * maintainers (once per UTC minute) when the global cap blocks traffic.
 */
export async function enforceSendCodeRateLimit(
  clientIp: string,
): Promise<void> {
  if (!sendCodeRateLimitsEnabled()) {
    return;
  }

  const now = new Date();
  const globalSince = new Date(now.getTime() - AUTH_SEND_CODE_GLOBAL_WINDOW_MS);
  const ipSince = new Date(now.getTime() - AUTH_SEND_CODE_IP_WINDOW_MS);

  const [globalCount, ipCount] = await Promise.all([
    countSendCodeAttemptsSince(globalSince),
    countIpAttemptsSince(clientIp, ipSince),
  ]);

  if (globalCount >= AUTH_SEND_CODE_GLOBAL_MAX_PER_MIN) {
    await notifyGlobalCapMaintainers({ now, attemptsInWindow: globalCount });
    throw new SendCodeRateLimitError(
      "Global send-code rate limit exceeded.",
      "global",
      60,
    );
  }

  if (ipCount >= AUTH_SEND_CODE_IP_MAX_PER_HOUR) {
    throw new SendCodeRateLimitError(
      "Too many verification codes requested from this network.",
      "ip",
      3600,
    );
  }

  const db = getDb();
  await db.insert(schema.authSendCodeAttempts).values({
    id: nanoid(16),
    clientIp,
    createdAt: now,
  });

  if (Math.random() < 0.02) {
    void pruneOldSendCodeAttempts().catch((error) => {
      console.warn("[send-code-rate-limit] prune failed:", error);
    });
  }
}
