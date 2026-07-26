import { NextRequest, NextResponse } from "next/server";

import {
  sendOpsAlert,
  type AlertSeverity,
} from "@/lib/ops/alert.server";
import { withApiErrorHandler } from "@/lib/ops/api-error";

function verifyIncomingSecret(req: NextRequest): boolean {
  const expected = process.env.OPS_ALERTS_INCOMING_SECRET?.trim();
  if (!expected) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${expected}`;
}

function parseSeverity(raw: unknown): AlertSeverity {
  if (raw === "page" || raw === "error" || raw === "warn" || raw === "info") {
    return raw;
  }
  return "error";
}

/** Relay alerts from Sentry rules and Better Stack / UptimeRobot monitors. */
async function postHandler(req: NextRequest) {
  if (!verifyIncomingSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source : "incoming";
  const severity = parseSeverity(body.severity);
  const title =
    typeof body.title === "string"
      ? body.title
      : typeof body.alert_title === "string"
        ? body.alert_title
        : "Incoming alert";
  const text =
    typeof body.body === "string"
      ? body.body
      : typeof body.message === "string"
        ? body.message
        : typeof body.description === "string"
          ? body.description
          : JSON.stringify(body).slice(0, 2000);

  const fingerprint =
    typeof body.fingerprint === "string"
      ? body.fingerprint
      : typeof body.monitor_id === "string"
        ? `betterstack:${body.monitor_id}`
        : typeof body.issue_id === "string"
          ? `sentry:${body.issue_id}`
          : undefined;

  const traceUrl =
    typeof body.traceUrl === "string" ? body.traceUrl : undefined;
  const runbookUrl =
    typeof body.runbookUrl === "string" ? body.runbookUrl : undefined;
  const sentryEventId =
    typeof body.event_id === "string" ? body.event_id : undefined;

  const result = await sendOpsAlert({
    severity,
    source,
    title,
    body: text,
    fingerprint,
    traceUrl,
    runbookUrl,
    sentryEventId,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const POST = withApiErrorHandler(postHandler);
