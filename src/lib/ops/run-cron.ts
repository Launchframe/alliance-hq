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
  /**
   * When true with `httpStatus` ≥ 500, record `degraded` and skip ops alert /
   * Sentry (expected soft failures such as VR with no report channels).
   */
  skipFailureAlert?: boolean;
  error?: string;
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

async function persistFailureAndAlert(options: {
  runId: string;
  name: string;
  durationMs: number;
  processed: number | null;
  errorClass: string;
  safeMessage: string;
  err?: unknown;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.cronRuns)
    .set({
      status: "failure",
      finishedAt: new Date(),
      durationMs: options.durationMs,
      processed: options.processed,
      errorClass: options.errorClass,
      errorMessage: options.safeMessage,
    })
    .where(eq(schema.cronRuns.id, options.runId));

  if (options.err !== undefined) {
    Sentry.captureException(options.err, { tags: { cron: options.name } });
  } else {
    Sentry.captureMessage(`Cron failed: ${options.name}`, {
      level: "error",
      tags: { cron: options.name },
      extra: {
        errorClass: options.errorClass,
        message: options.safeMessage,
      },
    });
  }

  await sendOpsAlert({
    severity: "error",
    source: `cron/${options.name}`,
    title: `Cron failed: ${options.name}`,
    body: `${options.errorClass}: ${options.safeMessage}`,
    fingerprint: `cron:${options.name}:failure`,
    runbookUrl: "/docs/ops/triage.md#cron-failure",
  });
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
    const httpStatus =
      typeof result.httpStatus === "number" ? result.httpStatus : 200;

    // Soft HTTP failures that still return a result object (video 502/503,
    // misconfigured workers). Alert unless the cron opted out (expected 503).
    if (httpStatus >= 500) {
      const safeMessage = scrubAlertText(
        typeof result.error === "string" ? result.error : `HTTP ${httpStatus}`,
      ).slice(0, 500);

      if (result.skipFailureAlert) {
        await db
          .update(schema.cronRuns)
          .set({
            status: "degraded",
            finishedAt: new Date(),
            durationMs,
            processed,
            errorClass: "ExpectedDegraded",
            errorMessage: safeMessage,
          })
          .where(eq(schema.cronRuns.id, runId));

        return NextResponse.json(
          { ok: false, ...result, durationMs },
          { status: httpStatus },
        );
      }

      await persistFailureAndAlert({
        runId,
        name,
        durationMs,
        processed,
        errorClass: `Http${httpStatus}`,
        safeMessage,
      });

      return NextResponse.json(
        { ok: false, ...result, durationMs },
        { status: httpStatus },
      );
    }

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
      { status: httpStatus },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorClass = err instanceof Error ? err.constructor.name : "Error";
    const errorMessage = err instanceof Error ? err.message : String(err);
    const safeMessage = scrubAlertText(errorMessage).slice(0, 500);

    await persistFailureAndAlert({
      runId,
      name,
      durationMs,
      processed: null,
      errorClass,
      safeMessage,
      err,
    });

    return NextResponse.json(
      { error: "Processing failed", message: safeMessage },
      { status: 500 },
    );
  }
}
