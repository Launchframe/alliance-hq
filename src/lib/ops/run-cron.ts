import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { getDb, schema } from "@/lib/db";
import { scrubAlertText } from "@/lib/observability/scrub";
import { sendOpsAlert } from "@/lib/ops/alert.server";

export interface CronResult {
  processed?: number;
  httpStatus?: number;
  [key: string]: unknown;
}

function extractProcessed(result: CronResult): number | null {
  if (typeof result.processed === "number") return result.processed;
  if (typeof result.sent === "number") return result.sent;
  if (typeof result.posted === "number") return result.posted;
  if (typeof result.synced === "number") return result.synced;
  if (typeof result.scanned === "number") return result.scanned;
  return null;
}

/** Uniform cron wrapper: persist run, capture failures, alert ops. */
export async function runCron<T extends CronResult>(
  name: string,
  fn: () => Promise<T>,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const runId = nanoid();
  const db = getDb();
  await db.insert(schema.cronRuns).values({
    id: runId,
    name,
    status: "running",
  });

  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    const processed = extractProcessed(result);

    await db
      .update(schema.cronRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        durationMs,
        processed,
      })
      .where(eq(schema.cronRuns.id, runId));

    return NextResponse.json(
      { ok: true, ...result, durationMs },
      {
        status:
          typeof result.httpStatus === "number" ? result.httpStatus : 200,
      },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorClass = err instanceof Error ? err.constructor.name : "Error";
    const errorMessage = err instanceof Error ? err.message : String(err);
    const safeMessage = scrubAlertText(errorMessage).slice(0, 500);

    await db
      .update(schema.cronRuns)
      .set({
        status: "failure",
        finishedAt: new Date(),
        durationMs,
        errorClass,
        errorMessage: safeMessage,
      })
      .where(eq(schema.cronRuns.id, runId));

    Sentry.captureException(err, { tags: { cron: name } });
    await sendOpsAlert({
      severity: "error",
      source: `cron/${name}`,
      title: `Cron failed: ${name}`,
      body: `${errorClass}: ${safeMessage}`,
      fingerprint: `cron:${name}:failure`,
      runbookUrl: "/docs/ops/triage.md#cron-failure",
    });

    return NextResponse.json(
      { error: "Processing failed", message: safeMessage },
      { status: 500 },
    );
  }
}
