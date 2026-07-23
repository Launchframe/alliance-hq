import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import {
  aggregateDepositSlipOcrEvalSnapshots,
  type DepositSlipOcrEvalAggregate,
  type DepositSlipOcrEvalSnapshotMetrics,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-ocr-eval-snapshots.server";
import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_KEY } from "@/lib/video/enqueue-deposit-slip-fingerprint-shadow-pass";

export type DepositSlipOcrEvalResponse = DepositSlipOcrEvalAggregate;

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 30);

  const db = getDb();

  const conditions = [
    eq(schema.ocrEvalSnapshots.scoreTarget, BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET),
    eq(
      schema.ocrEvalSnapshots.nativePassKey,
      DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_KEY,
    ),
  ];

  if (days > 0) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    conditions.push(gte(schema.ocrEvalSnapshots.createdAt, since));
  }

  const snapshots = await db
    .select({
      metricsJson: schema.ocrEvalSnapshots.metricsJson,
      createdAt: schema.ocrEvalSnapshots.createdAt,
    })
    .from(schema.ocrEvalSnapshots)
    .where(and(...conditions));

  const response: DepositSlipOcrEvalResponse = aggregateDepositSlipOcrEvalSnapshots(
    snapshots.map((row) => ({
      metricsJson: row.metricsJson as DepositSlipOcrEvalSnapshotMetrics | null,
      createdAt: row.createdAt,
    })),
  );

  return NextResponse.json(response);
}
