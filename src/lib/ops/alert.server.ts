import "server-only";

import { and, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { scrubAlertText } from "@/lib/observability/scrub";
import { emailPlatformMaintainers } from "@/lib/ops/platform-maintainer-alert.server";

export type AlertSeverity = "info" | "warn" | "error" | "page";

export interface SendOpsAlertInput {
  severity: AlertSeverity;
  source: string;
  title: string;
  body: string;
  fingerprint?: string;
  traceUrl?: string;
  runbookUrl?: string;
  sentryEventId?: string;
}

const DEDUP_WINDOW_MS = 15 * 60 * 1000;

function skipOutboundAlerts(): boolean {
  return process.env.E2E_TEST === "true";
}

function sanitizeAlertInput(input: SendOpsAlertInput): SendOpsAlertInput {
  return {
    ...input,
    source: scrubAlertText(input.source),
    title: scrubAlertText(input.title),
    body: scrubAlertText(input.body),
    fingerprint: input.fingerprint
      ? scrubAlertText(input.fingerprint)
      : undefined,
    traceUrl: input.traceUrl ? scrubAlertText(input.traceUrl) : undefined,
    runbookUrl: input.runbookUrl
      ? scrubAlertText(input.runbookUrl)
      : undefined,
    sentryEventId: input.sentryEventId
      ? scrubAlertText(input.sentryEventId)
      : undefined,
  };
}

function formatAlertMessage(input: SendOpsAlertInput): string {
  const lines = [
    `[${input.severity.toUpperCase()}] ${input.title}`,
    input.body,
    `Source: ${input.source}`,
  ];
  if (input.traceUrl) lines.push(`Trace: ${input.traceUrl}`);
  if (input.runbookUrl) lines.push(`Runbook: ${input.runbookUrl}`);
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendDiscordAlert(
  message: string,
  severity: AlertSeverity,
): Promise<boolean> {
  const url = process.env.DISCORD_OPS_WEBHOOK_URL?.trim();
  if (!url) return false;
  const prefix = severity === "page" ? "@here " : "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${prefix}${message.slice(0, 1900)}` }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isDuplicate(fingerprint: string | undefined): Promise<boolean> {
  if (!fingerprint) return false;
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.opsEvents.id })
    .from(schema.opsEvents)
    .where(
      and(
        eq(schema.opsEvents.fingerprint, fingerprint),
        gte(schema.opsEvents.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

/** Multi-channel ops alert with fingerprint dedup and DB persistence. */
export async function sendOpsAlert(
  input: SendOpsAlertInput,
): Promise<{ sent: boolean; eventId: string }> {
  const safeInput = sanitizeAlertInput(input);
  const message = formatAlertMessage(safeInput);
  const duplicate = await isDuplicate(safeInput.fingerprint);

  const channelStatus: Record<string, boolean> = {
    discord: false,
    email: false,
    skippedDuplicate: duplicate,
    skippedE2E: skipOutboundAlerts(),
  };

  if (!duplicate && !skipOutboundAlerts()) {
    channelStatus.discord = await sendDiscordAlert(message, input.severity);
    const emailResult = await emailPlatformMaintainers({
      subject: `[Alliance HQ ${input.severity}] ${safeInput.title}`,
      text: message,
      html: escapeHtml(message).replace(/\n/g, "<br>"),
    });
    channelStatus.email = emailResult.sent;
  }

  const eventId = nanoid();
  const db = getDb();
  await db.insert(schema.opsEvents).values({
    id: eventId,
    severity: safeInput.severity,
    source: safeInput.source,
    title: safeInput.title,
    body: safeInput.body,
    fingerprint: safeInput.fingerprint ?? null,
    sentryEventId: safeInput.sentryEventId ?? null,
    channelStatus,
  });

  const sent =
    !duplicate &&
    !skipOutboundAlerts() &&
    (channelStatus.discord || channelStatus.email);

  return { sent, eventId };
}
