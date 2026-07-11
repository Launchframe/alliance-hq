import "server-only";

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { CommanderIndexPayload } from "@/lib/commanders/index.shared";
import {
  summarizeByMainSquad,
  type CommanderTeamRow,
} from "@/lib/commanders/team-builder.shared";
import {
  assertCommanderReadAccess,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import { loadOAuthIdentitySplitsForAlliance } from "@/lib/auth/oauth-identity-split.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { commanderThpTotal } from "@/lib/commanders/power-stats.shared";
import {
  listAllianceSeasonVrForLeaderboard,
  resolveSeasonKey,
} from "@/lib/vr/repository";
import { listOwnedAshedMemberIdsForViewer } from "@/lib/commanders/main-squad.server";

export type { CommanderIndexPayload, CommanderIndexRow } from "@/lib/commanders/index.shared";

export async function loadCommanderIndex(
  sessionId: string,
): Promise<CommanderIndexPayload> {
  const { allianceId, hqUserId } =
    await resolveCommanderSessionContext(sessionId);
  await assertCommanderReadAccess(sessionId, allianceId);

  const db = getDb();
  const seasonKey = await resolveSeasonKey(allianceId);

  const [memberRows, seasonRows, canEdit, ownedMemberIds, hqLinkRows, oauthSplits, commanderStatsRows] =
    await Promise.all([
    db
      .select()
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, allianceId),
          eq(schema.allianceMembers.status, "active"),
        ),
      )
      .orderBy(
        desc(schema.allianceMembers.allianceRank),
        asc(schema.allianceMembers.currentName),
      ),
    listAllianceSeasonVrForLeaderboard(allianceId, seasonKey),
    sessionHasPermission(sessionId, "members:write"),
    hqUserId
      ? listOwnedAshedMemberIdsForViewer({ hqUserId, allianceId })
      : Promise.resolve([] as string[]),
    db
      .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
      .from(schema.hqMemberLinks)
      .where(eq(schema.hqMemberLinks.allianceId, allianceId)),
    loadOAuthIdentitySplitsForAlliance(allianceId),
    db
      .select({
        ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
        powerLevel: schema.commanders.powerLevel,
        currentTotalHeroPower: schema.commanders.currentTotalHeroPower,
        mainSquad: schema.commanders.mainSquad,
        mainSquadSource: schema.commanders.mainSquadSource,
      })
      .from(schema.commanderAllianceMemberships)
      .innerJoin(
        schema.commanders,
        eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
      )
      .where(
        and(
          eq(schema.commanderAllianceMemberships.allianceId, allianceId),
          isNull(schema.commanderAllianceMemberships.leftAt),
        ),
      ),
  ]);

  const hqLinkedMemberIds = new Set(
    hqLinkRows.map((row) => row.ashedMemberId),
  );

  const vrByMember = new Map(
    seasonRows.map((row) => [row.ashedMemberId, row.highestBaseVr]),
  );

  const commanderStatsByMember = new Map(
    commanderStatsRows.map((row) => [row.ashedMemberId, row]),
  );

  const teamRows: CommanderTeamRow[] = memberRows.map((memberRow) => {
    const stats = commanderStatsByMember.get(memberRow.ashedMemberId);
    return {
      ashedMemberId: memberRow.ashedMemberId,
      memberName: memberRow.currentName,
      totalHeroPower: commanderThpTotal({
        currentTotalHeroPower: stats?.currentTotalHeroPower ?? null,
      }),
      mainSquad: stats?.mainSquad ?? null,
      mainSquadSource: stats?.mainSquadSource ?? null,
      allianceRank: memberRow.allianceRank ?? null,
      highestBaseVr: vrByMember.get(memberRow.ashedMemberId) ?? null,
    };
  });

  const rows = teamRows.map((row) => {
    const stats = commanderStatsByMember.get(row.ashedMemberId);
    return {
      ashedMemberId: row.ashedMemberId,
      memberName: row.memberName,
      allianceRank: row.allianceRank,
      allianceRankTitle: null as string | null,
      powerLevel: stats?.powerLevel ?? null,
      totalHeroPower: row.totalHeroPower,
      mainSquad: row.mainSquad,
      mainSquadSource: row.mainSquadSource,
      highestBaseVr: row.highestBaseVr,
      hqLinked: hqLinkedMemberIds.has(row.ashedMemberId),
      oauthIdentitySplit: oauthSplits.has(row.ashedMemberId),
    };
  });

  for (const memberRow of memberRows) {
    const indexRow = rows.find(
      (r) => r.ashedMemberId === memberRow.ashedMemberId,
    );
    if (indexRow) {
      indexRow.allianceRankTitle = memberRow.allianceRankTitle ?? null;
    }
  }

  rows.sort((a, b) => {
    if (b.totalHeroPower !== a.totalHeroPower) {
      return b.totalHeroPower - a.totalHeroPower;
    }
    return a.memberName.localeCompare(b.memberName, undefined, {
      sensitivity: "base",
    });
  });

  return {
    seasonKey,
    rows,
    summaryBySquad: summarizeByMainSquad(teamRows),
    canEdit,
    canSelfReportMemberIds: ownedMemberIds,
  };
}
