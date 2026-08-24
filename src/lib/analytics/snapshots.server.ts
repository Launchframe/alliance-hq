import "server-only";

import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { computePercentile, percentileAt } from "@/lib/analytics/percentile.shared";
import { commanderThpTotal } from "@/lib/commanders/power-stats.shared";
import { isMissingSchemaError } from "@/lib/db/error-message";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";

export type SnapshotRow = {
  recordedDate: string;
  activeMemberCount: number;
  linkedCount: number;
  unlinkedCount: number;
  thpTotal: number | null;
  thpP50: number | null;
  thpP90: number | null;
  thpP99: number | null;
  donationTotal: number | null;
  donationP50: number | null;
  donationP90: number | null;
  donationP99: number | null;
};

export type DashboardRange = "30d" | "90d" | "all";

export function parseDashboardRange(raw: string | null): DashboardRange {
  if (raw === "30d" || raw === "all") return raw;
  return "90d";
}

export function rangeStartDate(range: DashboardRange, today: string): string | null {
  if (range === "all") return null;
  const days = range === "30d" ? 29 : 89;
  return addCalendarDays(today, -days);
}

function mapSnapshotRow(row: typeof schema.allianceDailySnapshots.$inferSelect): SnapshotRow {
  return {
    recordedDate: row.recordedDate,
    activeMemberCount: row.activeMemberCount,
    linkedCount: row.linkedCount,
    unlinkedCount: row.unlinkedCount,
    thpTotal: row.thpTotal,
    thpP50: row.thpP50,
    thpP90: row.thpP90,
    thpP99: row.thpP99,
    donationTotal: row.donationTotal,
    donationP50: row.donationP50,
    donationP90: row.donationP90,
    donationP99: row.donationP99,
  };
}

export async function loadSnapshotSeries(
  allianceId: string,
  range: DashboardRange,
): Promise<SnapshotRow[]> {
  try {
    const db = getDb();
    const today = getServerCalendarDate();
    const start = rangeStartDate(range, today);

    const conditions = [eq(schema.allianceDailySnapshots.allianceId, allianceId)];
    if (start) {
      conditions.push(gte(schema.allianceDailySnapshots.recordedDate, start));
    }

    const rows = await db
      .select()
      .from(schema.allianceDailySnapshots)
      .where(and(...conditions))
      .orderBy(asc(schema.allianceDailySnapshots.recordedDate));

    return rows.map(mapSnapshotRow);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Live alliance THP from commander identity (`commanders.current_total_hero_power`),
 * matching Members / roster. The legacy `member_total_hero_power_events` table is no
 * longer written; historical series come from `alliance_daily_snapshots` once the
 * daily job records these values.
 */
export async function loadAllianceCommanderThpRows(
  allianceId: string,
): Promise<
  Array<{ ashedMemberId: string; memberName: string; totalHeroPower: number }>
> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      primaryName: schema.commanders.primaryName,
      rosterName: schema.allianceMembers.currentName,
      currentTotalHeroPower: schema.commanders.currentTotalHeroPower,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .leftJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.commanderAllianceMemberships.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  const out: Array<{
    ashedMemberId: string;
    memberName: string;
    totalHeroPower: number;
  }> = [];
  for (const row of rows) {
    const totalHeroPower = commanderThpTotal({
      currentTotalHeroPower: row.currentTotalHeroPower,
    });
    if (totalHeroPower <= 0) continue;
    out.push({
      ashedMemberId: row.ashedMemberId,
      memberName:
        row.primaryName?.trim() ||
        row.rosterName?.trim() ||
        row.ashedMemberId,
      totalHeroPower,
    });
  }
  return out.sort((a, b) => b.totalHeroPower - a.totalHeroPower);
}

/** Live commander THP values. Date arg kept for call-site compatibility. */
export async function loadThpValuesForDate(
  allianceId: string,
  recordedDate: string,
): Promise<number[]> {
  void recordedDate;
  const rows = await loadAllianceCommanderThpRows(allianceId);
  return rows.map((row) => row.totalHeroPower);
}

export async function computeThpSnapshotForDate(
  allianceId: string,
  recordedDate: string,
): Promise<{
  thpTotal: number | null;
  thpP50: number | null;
  thpP90: number | null;
  thpP99: number | null;
}> {
  const values = await loadThpValuesForDate(allianceId, recordedDate);
  if (values.length === 0) {
    return { thpTotal: null, thpP50: null, thpP90: null, thpP99: null };
  }
  const thpTotal = values.reduce((sum, value) => sum + value, 0);
  return {
    thpTotal,
    thpP50: percentileAt(values, 50),
    thpP90: percentileAt(values, 90),
    thpP99: percentileAt(values, 99),
  };
}

export function computeViewerThpStanding(
  values: readonly number[],
  viewerThp: number | null,
) {
  if (viewerThp == null) return null;
  return computePercentile(values, viewerThp);
}

/** Live commander THP table. Date arg kept for call-site compatibility. */
export async function loadMemberThpTable(
  allianceId: string,
  recordedDate: string,
): Promise<
  Array<{ ashedMemberId: string; memberName: string; totalHeroPower: number }>
> {
  void recordedDate;
  return loadAllianceCommanderThpRows(allianceId);
}

/** Merge live commander THP into today's snapshot row so the dashboard is not empty before cron. */
export async function withLiveThpSeries(
  allianceId: string,
  series: SnapshotRow[],
): Promise<SnapshotRow[]> {
  const today = getServerCalendarDate();
  const live = await computeThpSnapshotForDate(allianceId, today);
  if (live.thpTotal == null) {
    return series;
  }

  const next = series.map((row) => ({ ...row }));
  const idx = next.findIndex((row) => row.recordedDate === today);
  if (idx >= 0) {
    const existing = next[idx]!;
    next[idx] = {
      ...existing,
      thpTotal: live.thpTotal,
      thpP50: live.thpP50,
      thpP90: live.thpP90,
      thpP99: live.thpP99,
    };
  } else {
    next.push({
      recordedDate: today,
      activeMemberCount: 0,
      linkedCount: 0,
      unlinkedCount: 0,
      thpTotal: live.thpTotal,
      thpP50: live.thpP50,
      thpP90: live.thpP90,
      thpP99: live.thpP99,
      donationTotal: null,
      donationP50: null,
      donationP90: null,
      donationP99: null,
    });
  }
  return next;
}

export async function upsertAllianceDailySnapshot(input: {
  allianceId: string;
  recordedDate: string;
  activeMemberCount: number;
  linkedCount: number;
  unlinkedCount: number;
  thpTotal: number | null;
  thpP50: number | null;
  thpP90: number | null;
  thpP99: number | null;
  donationTotal: number | null;
  donationP50: number | null;
  donationP90: number | null;
  donationP99: number | null;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.allianceDailySnapshots)
    .values({
      allianceId: input.allianceId,
      recordedDate: input.recordedDate,
      activeMemberCount: input.activeMemberCount,
      linkedCount: input.linkedCount,
      unlinkedCount: input.unlinkedCount,
      thpTotal: input.thpTotal,
      thpP50: input.thpP50,
      thpP90: input.thpP90,
      thpP99: input.thpP99,
      donationTotal: input.donationTotal,
      donationP50: input.donationP50,
      donationP90: input.donationP90,
      donationP99: input.donationP99,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.allianceDailySnapshots.allianceId,
        schema.allianceDailySnapshots.recordedDate,
      ],
      set: {
        activeMemberCount: input.activeMemberCount,
        linkedCount: input.linkedCount,
        unlinkedCount: input.unlinkedCount,
        thpTotal: input.thpTotal,
        thpP50: input.thpP50,
        thpP90: input.thpP90,
        thpP99: input.thpP99,
        donationTotal: input.donationTotal,
        donationP50: input.donationP50,
        donationP90: input.donationP90,
        donationP99: input.donationP99,
        computedAt: new Date(),
      },
    });
}

/** Write today's alliance THP snapshot from live commander totals. */
export async function backfillThpSnapshotsFromEvents(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const recordedDate = getServerCalendarDate();
  const thp = await computeThpSnapshotForDate(allianceId, recordedDate);
  if (thp.thpTotal == null) {
    return 0;
  }

  const [existing] = await db
    .select({ allianceId: schema.allianceDailySnapshots.allianceId })
    .from(schema.allianceDailySnapshots)
    .where(
      and(
        eq(schema.allianceDailySnapshots.allianceId, allianceId),
        eq(schema.allianceDailySnapshots.recordedDate, recordedDate),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.allianceDailySnapshots)
      .set({
        thpTotal: thp.thpTotal,
        thpP50: thp.thpP50,
        thpP90: thp.thpP90,
        thpP99: thp.thpP99,
        computedAt: new Date(),
      })
      .where(
        and(
          eq(schema.allianceDailySnapshots.allianceId, allianceId),
          eq(schema.allianceDailySnapshots.recordedDate, recordedDate),
        ),
      );
  } else {
    await upsertAllianceDailySnapshot({
      allianceId,
      recordedDate,
      activeMemberCount: 0,
      linkedCount: 0,
      unlinkedCount: 0,
      ...thp,
      donationTotal: null,
      donationP50: null,
      donationP90: null,
      donationP99: null,
    });
  }
  return 1;
}

export async function listActiveAllianceIds(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ id: schema.alliances.id }).from(schema.alliances);
  return rows.map((row) => row.id);
}

export async function loadLatestSnapshot(
  allianceId: string,
): Promise<SnapshotRow | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.allianceDailySnapshots)
      .where(eq(schema.allianceDailySnapshots.allianceId, allianceId))
      .orderBy(sql`${schema.allianceDailySnapshots.recordedDate} DESC`)
      .limit(1);

    if (!row) return null;
    return mapSnapshotRow(row);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw error;
  }
}

/** Latest completed video job time per score target since `since`. */
export async function loadRecentCompletedVideoJobTimes(
  allianceId: string,
  since: Date,
): Promise<Map<string, Date>> {
  const db = getDb();
  const rows = await db
    .select({
      scoreTarget: schema.videoJobs.scoreTarget,
      updatedAt: schema.videoJobs.updatedAt,
      createdAt: schema.videoJobs.createdAt,
    })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.allianceId, allianceId),
        inArray(schema.videoJobs.status, ["review", "submitting", "complete"]),
        sql`coalesce(${schema.videoJobs.updatedAt}, ${schema.videoJobs.createdAt}) >= ${since.toISOString()}`,
      ),
    );

  const latestByTarget = new Map<string, Date>();
  for (const row of rows) {
    if (!row.scoreTarget) continue;
    const at = row.updatedAt ?? row.createdAt;
    const existing = latestByTarget.get(row.scoreTarget);
    if (!existing || at > existing) {
      latestByTarget.set(row.scoreTarget, at);
    }
  }
  return latestByTarget;
}

export async function loadRecentCompletedVideoTargets(
  allianceId: string,
  since: Date,
): Promise<Set<string>> {
  const times = await loadRecentCompletedVideoJobTimes(allianceId, since);
  return new Set(times.keys());
}
