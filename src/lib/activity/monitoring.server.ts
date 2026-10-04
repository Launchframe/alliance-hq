import "server-only";

import { createHash } from "node:crypto";

import { waitUntil } from "@vercel/functions";
import { createTranslator } from "next-intl";
import { z } from "zod";

import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";

import {
  sendResendMessage,
  type ResendDeliveryResult,
} from "@/lib/ops/resend-transport.server";

import type { ActivityWriteError } from "./errors.server";

const ALERT_WINDOW_MS = 5 * 60 * 1000;
const TRANSPORT_RETRY_DELAY_MS = 250;
const DEPLOYMENT_PATTERN = /^[a-f0-9]{7,64}$/;
const ALERT_ENVIRONMENTS = [
  "production",
  "preview",
  "development",
  "test",
] as const;

const alertRecipientSchema = z
  .array(
    z
      .object({
        email: z.email(),
        locale: z.enum(["en-US", "pt-BR"]),
      })
      .strict(),
  )
  .max(20);

type ActivityAlertRecipient = z.infer<typeof alertRecipientSchema>[number];

const ALERT_MESSAGES: Record<
  ActivityAlertRecipient["locale"],
  Record<string, unknown>
> = {
  "en-US": { activity: enUS.activity },
  "pt-BR": { activity: ptBR.activity },
};

function parseAlertRecipients(): ActivityAlertRecipient[] | null {
  const raw = process.env.ACTIVITY_ALERT_RECIPIENTS;
  if (!raw) {
    return null;
  }
  try {
    const parsed = alertRecipientSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function resolveAlertEnvironment(): string {
  const raw = (
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    ""
  ).toLowerCase();
  return (ALERT_ENVIRONMENTS as readonly string[]).includes(raw)
    ? raw
    : "unknown";
}

function resolveAlertDeployment(): string {
  const raw = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return DEPLOYMENT_PATTERN.test(raw) ? raw : "unknown";
}

function logAlertSignal(
  signal: "activity_write_blocked_action" | "activity_alert_delivery_failed",
  fields: Record<string, string | number | boolean | null>,
): void {
  console.error(JSON.stringify({ signal, ...fields }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchActivityBlockedAlert(
  error: ActivityWriteError,
  now: Date = new Date(),
): Promise<{ sent: boolean; recipientCount: number }> {
  const environment = resolveAlertEnvironment();
  const deployment = resolveAlertDeployment();
  const windowIndex = Math.floor(now.getTime() / ALERT_WINDOW_MS);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        error.eventKey,
        error.failureCategory,
        environment,
        deployment,
        windowIndex,
      ]),
    )
    .digest("hex");
  const incident = fingerprint.slice(0, 16);
  const windowStart = new Date(windowIndex * ALERT_WINDOW_MS).toISOString();

  logAlertSignal("activity_write_blocked_action", {
    incidentId: error.incidentId,
    eventKey: error.eventKey,
    failureCategory: error.failureCategory,
    sqlState: error.sqlState,
    environment,
    deployment,
    incident,
  });

  const recipients = parseAlertRecipients();
  if (!recipients || recipients.length === 0) {
    logAlertSignal("activity_alert_delivery_failed", {
      reason: "missing_recipients",
      incidentId: error.incidentId,
      incident,
    });
    return { sent: false, recipientCount: 0 };
  }

  const results = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        const t = createTranslator({
          locale: recipient.locale,
          messages: ALERT_MESSAGES[recipient.locale],
        }) as unknown as (
          key: string,
          values?: Record<string, string>,
        ) => string;
        const lines = [
          t("activity.alert.body"),
          t("activity.alert.action", { action: error.eventKey }),
          t("activity.alert.environment", { environment }),
          t("activity.alert.failure", { failure: error.failureCategory }),
          t("activity.alert.incident", { incident }),
          t("activity.alert.logReference", { incidentId: error.incidentId }),
          t("activity.alert.window", { window: windowStart }),
          t("activity.alert.nextStep"),
        ];
        const request = {
          to: [recipient.email],
          subject: t("activity.alert.subject"),
          text: lines.join("\n"),
          html: `<p>${lines.map(escapeHtml).join("</p><p>")}</p>`,
          idempotencyKey: `${fingerprint.slice(0, 32)}-${createHash("sha256")
            .update(`${recipient.email}:${recipient.locale}`)
            .digest("hex")
            .slice(0, 32)}`,
        };

        let result: ResendDeliveryResult = await sendResendMessage(request);
        if (!result.sent && result.retryable) {
          await sleep(TRANSPORT_RETRY_DELAY_MS);
          result = await sendResendMessage(request);
        }
        if (!result.sent) {
          logAlertSignal("activity_alert_delivery_failed", {
            reason: result.reason,
            retryable: result.retryable,
            incidentId: error.incidentId,
            incident,
          });
        }
        return result.sent;
      } catch {
        logAlertSignal("activity_alert_delivery_failed", {
          reason: "dispatch",
          incidentId: error.incidentId,
          incident,
        });
        return false;
      }
    }),
  );
  const delivered = results.filter(Boolean).length;

  return { sent: delivered === recipients.length, recipientCount: delivered };
}

export function scheduleActivityBlockedAlert(error: ActivityWriteError): void {
  const task = dispatchActivityBlockedAlert(error).catch(() => {
    logAlertSignal("activity_alert_delivery_failed", {
      reason: "dispatch",
      incidentId: error.incidentId,
    });
  });
  if (process.env.VERCEL) {
    try {
      waitUntil(task);
    } catch {
      logAlertSignal("activity_alert_delivery_failed", {
        reason: "lifecycle",
        incidentId: error.incidentId,
      });
    }
  }
  void task;
}
