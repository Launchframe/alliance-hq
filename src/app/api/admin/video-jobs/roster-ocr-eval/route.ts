import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import {
  aggregateOcrEvalSnapshots,
  type OcrEvalDailyPoint,
  type OcrEvalSnapshotMetrics,
} from "@/lib/video/ocr-eval-snapshots.server";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";

export type RosterOcrEvalPassRow = {
  tessPassKey: string;
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
  avgPowerAgreement: number | null;
  avgLevelAgreement: number | null;
};

export type RosterOcrEvalByEngineRow = {
  primaryEngine: string;
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
};

export type RosterOcrEvalResponse = {
  jobCount: number;
  avgNameRecall: number | null;
  avgNamePrecision: number | null;
  avgRankAgreement: number | null;
  avgPowerAgreement: number | null;
  avgLevelAgreement: number | null;
  byPassKey: RosterOcrEvalPassRow[];
  dailySeries: OcrEvalDailyPoint[];
  byPrimaryEngine: RosterOcrEvalByEngineRow[];
};

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
  const campaignIdFilter = url.searchParams.get("campaignId");

  const db = getDb();

  const conditions = [
    eq(schema.ocrEvalSnapshots.scoreTarget, MEMBER_ROSTER_VIDEO_SCORE_TARGET),
  ];

  if (days > 0) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    conditions.push(gte(schema.ocrEvalSnapshots.createdAt, since));
  }

  if (passKeyFilter) {
    conditions.push(eq(schema.ocrEvalSnapshots.nativePassKey, passKeyFilter));
  }

  if (campaignIdFilter) {
    conditions.push(
      eq(schema.ocrEvalSnapshots.experimentCampaignId, campaignIdFilter),
    );
  }

  const snapshots = await db
    .select({
      nativePassKey: schema.ocrEvalSnapshots.nativePassKey,
      metricsJson: schema.ocrEvalSnapshots.metricsJson,
      createdAt: schema.ocrEvalSnapshots.createdAt,
      experimentArmId: schema.ocrEvalSnapshots.experimentArmId,
      primaryEngine: schema.ocrEvalSnapshots.primaryEngine,
    })
    .from(schema.ocrEvalSnapshots)
    .where(and(...conditions));

  const aggregated = aggregateOcrEvalSnapshots(
    snapshots.map((row) => ({
      nativePassKey: row.nativePassKey,
      metricsJson: row.metricsJson as OcrEvalSnapshotMetrics | null,
      createdAt: row.createdAt,
      experimentArmId: row.experimentArmId,
      primaryEngine: row.primaryEngine,
    })),
  );

  const response: RosterOcrEvalResponse = {
    jobCount: aggregated.jobCount,
    avgNameRecall: aggregated.avgNameRecall,
    avgNamePrecision: aggregated.avgNamePrecision,
    avgRankAgreement: aggregated.avgRankAgreement,
    avgPowerAgreement: aggregated.avgPowerAgreement,
    avgLevelAgreement: aggregated.avgLevelAgreement,
    byPassKey: aggregated.byPassKey.map((row) => ({
      tessPassKey: row.tessPassKey,
      jobCount: row.jobCount,
      avgNameRecall: row.avgNameRecall,
      avgNamePrecision: row.avgNamePrecision,
      avgRankAgreement: row.avgRankAgreement,
      avgPowerAgreement: row.avgPowerAgreement,
      avgLevelAgreement: row.avgLevelAgreement,
    })),
    dailySeries: aggregated.dailySeries,
    byPrimaryEngine: aggregated.byPrimaryEngine,
  };

  return NextResponse.json(response);
}
