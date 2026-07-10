import "server-only";

import { and, eq } from "drizzle-orm";

import {
  computeThpSnapshotForDate,
  upsertAllianceDailySnapshot,
} from "@/lib/analytics/snapshots.server";
import { getDb, schema } from "@/lib/db";
import { computeActiveHqLinkCounts } from "@/lib/members/members-linking-metrics.shared";
import { loadCommanderIndex } from "@/lib/commanders/index.server";
import type { CommanderIndexPayload } from "@/lib/commanders/index.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export async function computeAllianceDailySnapshotForAlliance(
  allianceId: string,
  recordedDate = getServerCalendarDate(),
): Promise<void> {
  const db = getDb();
  const [alliance] = await db
    .select({ id: schema.alliances.id, tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (!alliance) return;

  const memberRows = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.status, "active"),
      ),
    );

  const hqLinkRows = await db
    .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
    .from(schema.hqMemberLinks)
    .where(eq(schema.hqMemberLinks.allianceId, allianceId));

  const hqLinkedIds = new Set(hqLinkRows.map((row) => row.ashedMemberId));
  const linkCounts = computeActiveHqLinkCounts({
    members: memberRows.map((row) => ({
      id: row.ashedMemberId,
      ashed_member_id: row.ashedMemberId,
      status: row.status,
    })),
    commanderRows: memberRows.map((row) => ({
      ashedMemberId: row.ashedMemberId,
      hqLinked: hqLinkedIds.has(row.ashedMemberId),
    })),
  });

  const thp = await computeThpSnapshotForDate(allianceId, recordedDate);

  await upsertAllianceDailySnapshot({
    allianceId,
    recordedDate,
    activeMemberCount: linkCounts.total,
    linkedCount: linkCounts.linked,
    unlinkedCount: linkCounts.unlinked,
    ...thp,
    donationTotal: null,
    donationP50: null,
    donationP90: null,
    donationP99: null,
  });
}

export async function runAllianceDailySnapshotPass(
  recordedDate = getServerCalendarDate(),
): Promise<number> {
  const db = getDb();
  const alliances = await db.select({ id: schema.alliances.id }).from(schema.alliances);
  let count = 0;
  for (const alliance of alliances) {
    await computeAllianceDailySnapshotForAlliance(alliance.id, recordedDate);
    count += 1;
  }
  return count;
}

export async function loadSquadSummaryFromCommanderIndex(
  index: CommanderIndexPayload,
) {
  const squadPower = {
    aircraft: 0,
    tank: 0,
    missile: 0,
    unreported: 0,
  };

  for (const row of index.rows) {
    const key =
      row.mainSquad === "aircraft" ||
      row.mainSquad === "tank" ||
      row.mainSquad === "missile"
        ? row.mainSquad
        : "unreported";
    squadPower[key] += row.totalHeroPower;
  }

  return {
    summaryBySquad: index.summaryBySquad,
    squadPower,
  };
}

export async function loadSquadSummaryForDashboard(sessionId: string) {
  const index = await loadCommanderIndex(sessionId);
  return loadSquadSummaryFromCommanderIndex(index);
}

export async function loadUnlinkedMembersForOfficers(sessionId: string) {
  const index = await loadCommanderIndex(sessionId);
  return index.rows.filter((row) => !row.hqLinked);
}
