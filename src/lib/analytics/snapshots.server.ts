import "server-only";

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";

import { computePercentile, percentileAt } from "@/lib/analytics/percentile.shared";
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

export async function loadSnapshotSeries(
  allianceId: string,
  range: DashboardRange,
): Promise<SnapshotRow[]> {
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

  return rows.map((row) => ({
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
  }));
}

export async function loadThpValuesForDate(
  allianceId: string,
  recordedDate: string,
): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.memberTotalHeroPowerEvents.ashedMemberId,
      value: schema.memberTotalHeroPowerEvents.value,
      recordedDate: schema.memberTotalHeroPowerEvents.recordedDate,
    })
    .from(schema.memberTotalHeroPowerEvents)
    .where(
      and(
        eq(schema.memberTotalHeroPowerEvents.allianceId, allianceId),
        sql`${schema.memberTotalHeroPowerEvents.recordedDate} <= ${recordedDate}`,
      ),
    )
    .orderBy(
      asc(schema.memberTotalHeroPowerEvents.ashedMemberId),
      sql`${schema.memberTotalHeroPowerEvents.recordedDate} DESC`,
    );

  const latestByMember = new Map<string, number>();
  for (const row of rows) {
    if (!latestByMember.has(row.ashedMemberId)) {
      latestByMember.set(row.ashedMemberId, row.value);
    }
  }

  return [...latestByMember.values()];
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

export async function loadMemberThpTable(
  allianceId: string,
  recordedDate: string,
): Promise<
  Array<{ ashedMemberId: string; memberName: string; totalHeroPower: number }>
> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.memberTotalHeroPowerEvents.ashedMemberId,
      memberName: schema.memberTotalHeroPowerEvents.memberName,
      value: schema.memberTotalHeroPowerEvents.value,
    })
    .from(schema.memberTotalHeroPowerEvents)
    .where(
      and(
        eq(schema.memberTotalHeroPowerEvents.allianceId, allianceId),
        sql`${schema.memberTotalHeroPowerEvents.recordedDate} <= ${recordedDate}`,
      ),
    )
    .orderBy(
      asc(schema.memberTotalHeroPowerEvents.ashedMemberId),
      sql`${schema.memberTotalHeroPowerEvents.recordedDate} DESC`,
    );

  const latest = new Map<
    string,
    { ashedMemberId: string; memberName: string; totalHeroPower: number }
  >();
  for (const row of rows) {
    if (!latest.has(row.ashedMemberId)) {
      latest.set(row.ashedMemberId, {
        ashedMemberId: row.ashedMemberId,
        memberName: row.memberName,
        totalHeroPower: row.value,
      });
    }
  }

  return [...latest.values()].sort((a, b) => b.totalHeroPower - a.totalHeroPower);
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

export async function backfillThpSnapshotsFromEvents(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const dates = await db
    .selectDistinct({
      recordedDate: schema.memberTotalHeroPowerEvents.recordedDate,
    })
    .from(schema.memberTotalHeroPowerEvents)
    .where(eq(schema.memberTotalHeroPowerEvents.allianceId, allianceId))
    .orderBy(asc(schema.memberTotalHeroPowerEvents.recordedDate));

  let written = 0;
  for (const { recordedDate } of dates) {
    const thp = await computeThpSnapshotForDate(allianceId, recordedDate);
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
    written += 1;
  }
  return written;
}

export async function listActiveAllianceIds(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ id: schema.alliances.id }).from(schema.alliances);
  return rows.map((row) => row.id);
}

export async function loadLatestSnapshot(
  allianceId: string,
): Promise<SnapshotRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.allianceDailySnapshots)
    .where(eq(schema.allianceDailySnapshots.allianceId, allianceId))
    .orderBy(sql`${schema.allianceDailySnapshots.recordedDate} DESC`)
    .limit(1);

  if (!row) return null;

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

export async function loadRecentCompletedVideoTargets(
  allianceId: string,
  since: Date,
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ scoreTarget: schema.videoJobs.scoreTarget })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.allianceId, allianceId),
        inArray(schema.videoJobs.status, ["review", "submitting", "complete"]),
        sql`coalesce(${schema.videoJobs.updatedAt}, ${schema.videoJobs.createdAt}) >= ${since}`,
      ),
    );

  return new Set(rows.map((row) => row.scoreTarget).filter(Boolean) as string[]);
}
