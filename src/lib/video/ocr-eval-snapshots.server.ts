import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { RosterTesseractEvalMetrics } from "@/lib/video/compare-roster-ocr-quality";
import type { VideoOcrEngine } from "@/lib/video/ocr-provider.shared";

export type OcrEvalSnapshotMetrics = RosterTesseractEvalMetrics & {
  computedAt: string;
};

export type PersistOcrEvalSnapshotInput = {
  groupId: string;
  primaryJobId: string;
  shadowJobId: string;
  scoreTarget: string | null;
  boardKey: string | null;
  hqEventId: string | null;
  primaryEngine: VideoOcrEngine;
  shadowEngine: VideoOcrEngine;
  nativePassKey: string | null;
  experimentCampaignId: string | null;
  experimentArmId: string | null;
  metrics: RosterTesseractEvalMetrics;
  shadowTotalMs: number | null;
};

export async function persistOcrEvalSnapshot(
  input: PersistOcrEvalSnapshotInput,
): Promise<string> {
  const db = getDb();
  const id = nanoid(16);
  const metricsJson: OcrEvalSnapshotMetrics = {
    ...input.metrics,
    computedAt: new Date().toISOString(),
  };

  await db.insert(schema.ocrEvalSnapshots).values({
    id,
    groupId: input.groupId,
    primaryJobId: input.primaryJobId,
    shadowJobId: input.shadowJobId,
    scoreTarget: input.scoreTarget,
    boardKey: input.boardKey,
    hqEventId: input.hqEventId,
    primaryEngine: input.primaryEngine,
    shadowEngine: input.shadowEngine,
    nativePassKey: input.nativePassKey,
    experimentCampaignId: input.experimentCampaignId,
    experimentArmId: input.experimentArmId,
    metricsJson,
    shadowTotalMs:
      input.shadowTotalMs != null ? Math.round(input.shadowTotalMs) : null,
    createdAt: new Date(),
  });

  return id;
}

export type OcrEvalDailyPoint = {
  date: string;
  passKey: string;
  nameRecall: number | null;
  namePrecision: number | null;
  rankAgreement: number | null;
  jobCount: number;
};

function avgNullable(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export type OcrEvalByArmRow = {
  armId: string;
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
  avgPowerAgreement: number | null;
  avgLevelAgreement: number | null;
};

export function aggregateOcrEvalByArm(
  rows: Array<{
    experimentArmId: string | null;
    metricsJson: OcrEvalSnapshotMetrics | null;
  }>,
): OcrEvalByArmRow[] {
  const byArm = new Map<string, OcrEvalSnapshotMetrics[]>();

  for (const row of rows) {
    if (!row.experimentArmId || !row.metricsJson) continue;
    const bucket = byArm.get(row.experimentArmId) ?? [];
    bucket.push(row.metricsJson);
    byArm.set(row.experimentArmId, bucket);
  }

  return [...byArm.entries()]
    .map(([armId, list]) => ({
      armId,
      jobCount: list.length,
      avgNameRecall: avgNullable(list.map((m) => m.nameRecall)),
      avgNamePrecision: avgNullable(list.map((m) => m.namePrecision)),
      avgRankAgreement: avgNullable(list.map((m) => m.rankAgreement)),
      avgPowerAgreement: avgNullable(list.map((m) => m.powerAgreement)),
      avgLevelAgreement: avgNullable(list.map((m) => m.levelAgreement)),
    }))
    .sort((a, b) => a.armId.localeCompare(b.armId));
}

export function aggregateOcrEvalSnapshots(
  rows: Array<{
    nativePassKey: string | null;
    metricsJson: OcrEvalSnapshotMetrics | null;
    createdAt: Date;
    experimentArmId: string | null;
    primaryEngine: string;
  }>,
): {
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
  avgPowerAgreement: number | null;
  avgLevelAgreement: number | null;
  byPassKey: Array<{
    tessPassKey: string;
    jobCount: number;
    avgNameRecall: number | null;
    avgNamePrecision: number | null;
    avgRankAgreement: number | null;
    avgPowerAgreement: number | null;
    avgLevelAgreement: number | null;
  }>;
  dailySeries: OcrEvalDailyPoint[];
  byPrimaryEngine: Array<{
    primaryEngine: string;
    jobCount: number;
    avgNameRecall: number | null;
    avgNamePrecision: number | null;
    avgRankAgreement: number | null;
  }>;
} {
  const metricsRows = rows
    .map((row) => ({
      tessPassKey: row.nativePassKey ?? "unknown",
      metrics: row.metricsJson,
      date: row.createdAt.toISOString().slice(0, 10),
      primaryEngine: row.primaryEngine,
    }))
    .filter((row): row is typeof row & { metrics: OcrEvalSnapshotMetrics } =>
      !!row.metrics,
    );

  const byPassKeyMap = new Map<string, OcrEvalSnapshotMetrics[]>();
  const byEngineMap = new Map<string, OcrEvalSnapshotMetrics[]>();
  const dailyMap = new Map<string, OcrEvalSnapshotMetrics[]>();

  for (const row of metricsRows) {
    const passBucket = byPassKeyMap.get(row.tessPassKey) ?? [];
    passBucket.push(row.metrics);
    byPassKeyMap.set(row.tessPassKey, passBucket);

    const engineBucket = byEngineMap.get(row.primaryEngine) ?? [];
    engineBucket.push(row.metrics);
    byEngineMap.set(row.primaryEngine, engineBucket);

    const dailyKey = `${row.date}::${row.tessPassKey}`;
    const dailyBucket = dailyMap.get(dailyKey) ?? [];
    dailyBucket.push(row.metrics);
    dailyMap.set(dailyKey, dailyBucket);
  }

  const allMetrics = metricsRows.map((row) => row.metrics);

  const dailySeries: OcrEvalDailyPoint[] = [...dailyMap.entries()]
    .map(([key, list]) => {
      const [date, passKey] = key.split("::");
      return {
        date: date!,
        passKey: passKey!,
        nameRecall: avgNullable(list.map((m) => m.nameRecall)),
        namePrecision: avgNullable(list.map((m) => m.namePrecision)),
        rankAgreement: avgNullable(list.map((m) => m.rankAgreement)),
        jobCount: list.length,
      };
    })
    .sort((a, b) =>
      a.date === b.date ? a.passKey.localeCompare(b.passKey) : a.date.localeCompare(b.date),
    );

  return {
    jobCount: allMetrics.length,
    avgNameRecall: avgNullable(allMetrics.map((m) => m.nameRecall)),
    avgNamePrecision: avgNullable(allMetrics.map((m) => m.namePrecision)),
    avgRankAgreement: avgNullable(allMetrics.map((m) => m.rankAgreement)),
    avgPowerAgreement: avgNullable(allMetrics.map((m) => m.powerAgreement)),
    avgLevelAgreement: avgNullable(allMetrics.map((m) => m.levelAgreement)),
    byPassKey: [...byPassKeyMap.entries()]
      .map(([tessPassKey, list]) => ({
        tessPassKey,
        jobCount: list.length,
        avgNameRecall: avgNullable(list.map((m) => m.nameRecall)),
        avgNamePrecision: avgNullable(list.map((m) => m.namePrecision)),
        avgRankAgreement: avgNullable(list.map((m) => m.rankAgreement)),
        avgPowerAgreement: avgNullable(list.map((m) => m.powerAgreement)),
        avgLevelAgreement: avgNullable(list.map((m) => m.levelAgreement)),
      }))
      .sort((a, b) => a.tessPassKey.localeCompare(b.tessPassKey)),
    dailySeries,
    byPrimaryEngine: [...byEngineMap.entries()]
      .map(([primaryEngine, list]) => ({
        primaryEngine,
        jobCount: list.length,
        avgNameRecall: avgNullable(list.map((m) => m.nameRecall)),
        avgNamePrecision: avgNullable(list.map((m) => m.namePrecision)),
        avgRankAgreement: avgNullable(list.map((m) => m.rankAgreement)),
      }))
      .sort((a, b) => a.primaryEngine.localeCompare(b.primaryEngine)),
  };
}
