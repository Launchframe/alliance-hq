import "server-only";

import { desc, eq, gte, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { ScreenshotOcrFailureCode } from "@/lib/ocr/screenshot-ocr-quality.shared";
import {
  aggregateScreenshotHygieneFleetKpis,
  aggregateScreenshotHygieneRewards,
  type ScreenshotHygieneFleetKpis,
  type ScreenshotHygieneReward,
} from "@/lib/ocr/screenshot-hygiene-rewards.shared";

const DEFAULT_LOOKBACK_DAYS = 30;

function readQuality(row: {
  qualityJson: unknown;
  parsedOk: number;
  complete: number;
  entryCount: number | null;
}): {
  parsedOk: boolean;
  complete: boolean;
  pairedCount: number;
  failureCodes: ScreenshotOcrFailureCode[];
  userConfirmed: boolean | null;
} {
  const quality = (row.qualityJson ?? {}) as {
    failureCodes?: ScreenshotOcrFailureCode[];
    pairedCount?: number;
    userConfirmed?: boolean | null;
  };
  return {
    parsedOk: row.parsedOk === 1,
    complete: row.complete === 1,
    pairedCount: quality.pairedCount ?? row.entryCount ?? 0,
    failureCodes: quality.failureCodes ?? [],
    userConfirmed: quality.userConfirmed ?? null,
  };
}

export async function loadScreenshotHygieneFleetKpis(input?: {
  source?: string;
  lookbackDays?: number;
}): Promise<ScreenshotHygieneFleetKpis> {
  const db = getDb();
  const lookbackDays = input?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      qualityJson: schema.screenshotOcrJobs.qualityJson,
      parsedOk: schema.screenshotOcrJobs.parsedOk,
      complete: schema.screenshotOcrJobs.complete,
      entryCount: schema.screenshotOcrJobs.entryCount,
    })
    .from(schema.screenshotOcrJobs)
    .where(
      input?.source
        ? sql`${schema.screenshotOcrJobs.createdAt} >= ${since} AND ${schema.screenshotOcrJobs.source} = ${input.source}`
        : gte(schema.screenshotOcrJobs.createdAt, since),
    )
    .orderBy(desc(schema.screenshotOcrJobs.createdAt))
    .limit(5000);

  return aggregateScreenshotHygieneFleetKpis(rows.map(readQuality));
}

export async function loadScreenshotHygieneRewards(input?: {
  source?: string;
  lookbackDays?: number;
}): Promise<ScreenshotHygieneReward[]> {
  const db = getDb();
  const lookbackDays = input?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      source: schema.screenshotOcrJobs.source,
      hqUserId: schema.screenshotOcrJobs.hqUserId,
      discordUserId: schema.screenshotOcrJobs.discordUserId,
      qualityJson: schema.screenshotOcrJobs.qualityJson,
      parsedOk: schema.screenshotOcrJobs.parsedOk,
      complete: schema.screenshotOcrJobs.complete,
      entryCount: schema.screenshotOcrJobs.entryCount,
    })
    .from(schema.screenshotOcrJobs)
    .where(
      input?.source
        ? sql`${schema.screenshotOcrJobs.createdAt} >= ${since} AND ${schema.screenshotOcrJobs.source} = ${input.source}`
        : gte(schema.screenshotOcrJobs.createdAt, since),
    )
    .orderBy(desc(schema.screenshotOcrJobs.createdAt))
    .limit(5000);

  return aggregateScreenshotHygieneRewards(
    rows.map((row) => ({
      subjectKey:
        row.hqUserId ?? row.discordUserId ?? `unknown:${row.source}`,
      source: row.source,
      ...readQuality(row),
    })),
  );
}

export async function countRecentCropMisalignedStreak(input: {
  hqUserId?: string | null;
  discordUserId?: string | null;
  source?: string;
  limit?: number;
}): Promise<number> {
  if (!input.hqUserId && !input.discordUserId) return 0;
  const db = getDb();
  const limit = input.limit ?? 5;

  const rows = await db
    .select({ qualityJson: schema.screenshotOcrJobs.qualityJson })
    .from(schema.screenshotOcrJobs)
    .where(
      input.hqUserId
        ? eq(schema.screenshotOcrJobs.hqUserId, input.hqUserId)
        : eq(schema.screenshotOcrJobs.discordUserId, input.discordUserId!),
    )
    .orderBy(desc(schema.screenshotOcrJobs.createdAt))
    .limit(limit);

  let streak = 0;
  for (const row of rows) {
    const failureCodes =
      ((row.qualityJson ?? {}) as { failureCodes?: string[] }).failureCodes ??
      [];
    if (!failureCodes.includes("crop_misaligned")) break;
    streak += 1;
  }
  return streak;
}
