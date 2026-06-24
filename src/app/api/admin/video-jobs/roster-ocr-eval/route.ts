import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import type { RosterTesseractEvalMetrics } from "@/lib/video/compare-roster-ocr-quality";

export type RosterOcrEvalPassRow = {
  tessPassKey: string;
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
  avgPowerAgreement: number | null;
  avgLevelAgreement: number | null;
};

export type RosterOcrEvalResponse = {
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
  avgPowerAgreement: number | null;
  avgLevelAgreement: number | null;
  byPassKey: RosterOcrEvalPassRow[];
};

function avgNullable(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 30);
  const passKeyFilter = url.searchParams.get("tessPassKey");

  const db = getDb();

  const conditions = [
    sql`${schema.videoUploadGroups.comparisonJson}->>'kind' = 'roster_tesseract_eval'`,
    eq(schema.videoUploadGroups.scoreTarget, "member-roster-video"),
  ];

  if (days > 0) {
    conditions.push(
      sql`${schema.videoUploadGroups.createdAt} >= now() - ${sql.raw(`'${days} days'::interval`)}`,
    );
  }

  const groups = await db
    .select({
      comparisonJson: schema.videoUploadGroups.comparisonJson,
    })
    .from(schema.videoUploadGroups)
    .where(and(...conditions));

  const rows = groups
    .map((group) => {
      const comparison = group.comparisonJson as {
        tessPassKey?: string | null;
        metrics?: RosterTesseractEvalMetrics;
      } | null;
      if (!comparison?.metrics) return null;
      if (passKeyFilter && comparison.tessPassKey !== passKeyFilter) return null;
      return {
        tessPassKey: comparison.tessPassKey ?? "unknown",
        metrics: comparison.metrics,
      };
    })
    .filter((row): row is { tessPassKey: string; metrics: RosterTesseractEvalMetrics } => !!row);

  const byPassKeyMap = new Map<string, RosterTesseractEvalMetrics[]>();
  for (const row of rows) {
    const bucket = byPassKeyMap.get(row.tessPassKey) ?? [];
    bucket.push(row.metrics);
    byPassKeyMap.set(row.tessPassKey, bucket);
  }

  const byPassKey: RosterOcrEvalPassRow[] = [...byPassKeyMap.entries()]
    .map(([tessPassKey, metricsList]) => ({
      tessPassKey,
      jobCount: metricsList.length,
      avgNameRecall: avgNullable(metricsList.map((m) => m.nameRecall)),
      avgNamePrecision: avgNullable(metricsList.map((m) => m.namePrecision)),
      avgRankAgreement: avgNullable(metricsList.map((m) => m.rankAgreement)),
      avgPowerAgreement: avgNullable(metricsList.map((m) => m.powerAgreement)),
      avgLevelAgreement: avgNullable(metricsList.map((m) => m.levelAgreement)),
    }))
    .sort((a, b) => a.tessPassKey.localeCompare(b.tessPassKey));

  const allMetrics = rows.map((row) => row.metrics);
  const response: RosterOcrEvalResponse = {
    jobCount: allMetrics.length,
    avgNameRecall: avgNullable(allMetrics.map((m) => m.nameRecall)),
    avgNamePrecision: avgNullable(allMetrics.map((m) => m.namePrecision)),
    avgRankAgreement: avgNullable(allMetrics.map((m) => m.rankAgreement)),
    avgPowerAgreement: avgNullable(allMetrics.map((m) => m.powerAgreement)),
    avgLevelAgreement: avgNullable(allMetrics.map((m) => m.levelAgreement)),
    byPassKey,
  };

  return NextResponse.json(response);
}
