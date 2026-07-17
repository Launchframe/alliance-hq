import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { DepositSlipTesseractEvalMetrics } from "@/lib/banks/deposit-slip-ocr/compare-deposit-slip-ocr-quality.shared";
import { DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_KEY } from "@/lib/video/enqueue-deposit-slip-fingerprint-shadow-pass";
import { BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";

/**
 * Persists to the same `ocr_eval_snapshots` table the roster tesseract
 * shadow pass uses (see `ocr-eval-snapshots.server.ts`) — `metricsJson` is
 * `jsonb`, so it happily stores this differently-shaped metrics object.
 * Rows are distinguished by `scoreTarget` (`bank-deposit-slip-history` here
 * vs `member-roster-video` there) and `nativePassKey`
 * (`row_fingerprint_v1`), so aggregation queries never need to inspect
 * `metricsJson` shape to tell them apart.
 */
export type DepositSlipOcrEvalSnapshotMetrics = DepositSlipTesseractEvalMetrics & {
  computedAt: string;
  rawLineCount: number | null;
  uniqueLineCount: number | null;
};

export type PersistDepositSlipOcrEvalSnapshotInput = {
  groupId: string;
  primaryJobId: string;
  shadowJobId: string;
  boardKey: string | null;
  hqEventId: string | null;
  metrics: DepositSlipTesseractEvalMetrics;
  shadowTotalMs: number | null;
  rawLineCount: number | null;
  uniqueLineCount: number | null;
};

export async function persistDepositSlipOcrEvalSnapshot(
  input: PersistDepositSlipOcrEvalSnapshotInput,
): Promise<string> {
  const db = getDb();
  const id = nanoid(16);
  const metricsJson: DepositSlipOcrEvalSnapshotMetrics = {
    ...input.metrics,
    computedAt: new Date().toISOString(),
    rawLineCount: input.rawLineCount,
    uniqueLineCount: input.uniqueLineCount,
  };

  await db.insert(schema.ocrEvalSnapshots).values({
    id,
    groupId: input.groupId,
    primaryJobId: input.primaryJobId,
    shadowJobId: input.shadowJobId,
    scoreTarget: BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET,
    boardKey: input.boardKey,
    hqEventId: input.hqEventId,
    primaryEngine: "native",
    shadowEngine: "native",
    nativePassKey: DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_KEY,
    experimentCampaignId: null,
    experimentArmId: null,
    metricsJson,
    shadowTotalMs:
      input.shadowTotalMs != null ? Math.round(input.shadowTotalMs) : null,
    createdAt: new Date(),
  });

  return id;
}

function avgNullable(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export type DepositSlipOcrEvalDailyPoint = {
  date: string;
  jobCount: number;
  avgRowRecall: number | null;
  avgPrimaryMissingDepositAtRate: number | null;
  avgShadowMissingDepositAtRate: number | null;
};

export type DepositSlipOcrEvalAggregate = {
  jobCount: number;
  avgRowRecall: number | null;
  avgRowPrecision: number | null;
  avgDepositAtAgreement: number | null;
  avgPrimaryMissingDepositAtRate: number | null;
  avgShadowMissingDepositAtRate: number | null;
  avgAmountAgreement: number | null;
  avgTermDaysAgreement: number | null;
  avgStatusAgreement: number | null;
  avgRawLineCount: number | null;
  avgUniqueLineCount: number | null;
  avgLineReductionRate: number | null;
  dailySeries: DepositSlipOcrEvalDailyPoint[];
};

/**
 * Aggregate raw `ocr_eval_snapshots` rows (already filtered by caller to
 * `scoreTarget = bank-deposit-slip-history`) into dashboard-ready summaries.
 * Kept as a pure function (no DB access) so the admin API route and unit
 * tests can share it without mocking Drizzle.
 */
export function aggregateDepositSlipOcrEvalSnapshots(
  rows: Array<{
    metricsJson: DepositSlipOcrEvalSnapshotMetrics | null;
    createdAt: Date;
  }>,
): DepositSlipOcrEvalAggregate {
  const metricsRows = rows
    .map((row) => ({
      metrics: row.metricsJson,
      date: row.createdAt.toISOString().slice(0, 10),
    }))
    .filter(
      (row): row is typeof row & { metrics: DepositSlipOcrEvalSnapshotMetrics } =>
        !!row.metrics,
    );

  const allMetrics = metricsRows.map((row) => row.metrics);

  const dailyMap = new Map<string, DepositSlipOcrEvalSnapshotMetrics[]>();
  for (const row of metricsRows) {
    const bucket = dailyMap.get(row.date) ?? [];
    bucket.push(row.metrics);
    dailyMap.set(row.date, bucket);
  }

  const dailySeries: DepositSlipOcrEvalDailyPoint[] = [...dailyMap.entries()]
    .map(([date, list]) => ({
      date,
      jobCount: list.length,
      avgRowRecall: avgNullable(list.map((m) => m.rowRecall)),
      avgPrimaryMissingDepositAtRate: avgNullable(
        list.map((m) => m.primaryMissingDepositAtRate),
      ),
      avgShadowMissingDepositAtRate: avgNullable(
        list.map((m) => m.shadowMissingDepositAtRate),
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const lineReductionRates = allMetrics
    .map((m) =>
      m.rawLineCount != null && m.rawLineCount > 0 && m.uniqueLineCount != null
        ? 1 - m.uniqueLineCount / m.rawLineCount
        : null,
    )
    .filter((v): v is number => v != null);

  return {
    jobCount: allMetrics.length,
    avgRowRecall: avgNullable(allMetrics.map((m) => m.rowRecall)),
    avgRowPrecision: avgNullable(allMetrics.map((m) => m.rowPrecision)),
    avgDepositAtAgreement: avgNullable(allMetrics.map((m) => m.depositAtAgreement)),
    avgPrimaryMissingDepositAtRate: avgNullable(
      allMetrics.map((m) => m.primaryMissingDepositAtRate),
    ),
    avgShadowMissingDepositAtRate: avgNullable(
      allMetrics.map((m) => m.shadowMissingDepositAtRate),
    ),
    avgAmountAgreement: avgNullable(allMetrics.map((m) => m.amountAgreement)),
    avgTermDaysAgreement: avgNullable(allMetrics.map((m) => m.termDaysAgreement)),
    avgStatusAgreement: avgNullable(allMetrics.map((m) => m.statusAgreement)),
    avgRawLineCount: avgNullable(allMetrics.map((m) => m.rawLineCount)),
    avgUniqueLineCount: avgNullable(allMetrics.map((m) => m.uniqueLineCount)),
    avgLineReductionRate: avgNullable(lineReductionRates),
    dailySeries,
  };
}
