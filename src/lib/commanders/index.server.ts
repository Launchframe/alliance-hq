import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

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
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import { loadOAuthIdentitySplitsForAlliance } from "@/lib/auth/oauth-identity-split.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { memberTotalHeroPower } from "@/lib/vr/leaderboard";
import { resolveSeasonKey } from "@/lib/vr/repository";
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

  const [memberRows, seasonRows, canEdit, ownedMemberIds, hqLinkRows, oauthSplits] =
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
        desc(schema.allianceMembers.currentTotalHeroPower),
        desc(schema.allianceMembers.allianceRank),
        asc(schema.allianceMembers.currentName),
      ),
    db
      .select()
      .from(schema.memberSeasonVr)
      .where(
        and(
          eq(schema.memberSeasonVr.allianceId, allianceId),
          eq(schema.memberSeasonVr.seasonKey, seasonKey),
        ),
      ),
    sessionHasPermission(sessionId, "members:write"),
    hqUserId
      ? listOwnedAshedMemberIdsForViewer({ hqUserId, allianceId })
      : Promise.resolve([] as string[]),
    db
      .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
      .from(schema.hqMemberLinks)
      .where(eq(schema.hqMemberLinks.allianceId, allianceId)),
    loadOAuthIdentitySplitsForAlliance(allianceId),
  ]);

  const hqLinkedMemberIds = new Set(
    hqLinkRows.map((row) => row.ashedMemberId),
  );

  const vrByMember = new Map(
    seasonRows.map((row) => [row.ashedMemberId, row.highestBaseVr]),
  );

  const teamRows: CommanderTeamRow[] = memberRows.map((memberRow) => {
    const ashedMember = allianceMemberRowToAshedMember(memberRow);
    return {
      ashedMemberId: memberRow.ashedMemberId,
      memberName: memberRow.currentName,
      totalHeroPower: memberTotalHeroPower(ashedMember),
      mainSquad: memberRow.mainSquad ?? null,
      mainSquadSource: null,
      allianceRank: memberRow.allianceRank ?? null,
      highestBaseVr: vrByMember.get(memberRow.ashedMemberId) ?? null,
    };
  });

  const commanderIds = memberRows
    .map((row) => row.ashedMemberId)
    .filter(Boolean);

  const sourceByMember = new Map<string, "self_report" | "officer_override">();
  if (commanderIds.length > 0) {
    const commanderRows = await db
      .select({
        ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
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
          inArray(
            schema.commanderAllianceMemberships.ashedMemberId,
            commanderIds,
          ),
          isNull(schema.commanderAllianceMemberships.leftAt),
        ),
      );

    for (const row of commanderRows) {
      if (row.mainSquadSource) {
        sourceByMember.set(row.ashedMemberId, row.mainSquadSource);
      }
    }
  }

  const rows = teamRows.map((row) => ({
    ashedMemberId: row.ashedMemberId,
    memberName: row.memberName,
    allianceRank: row.allianceRank,
    allianceRankTitle: null as string | null,
    totalHeroPower: row.totalHeroPower,
    mainSquad: row.mainSquad,
    mainSquadSource: sourceByMember.get(row.ashedMemberId) ?? null,
    highestBaseVr: row.highestBaseVr,
    hqLinked: hqLinkedMemberIds.has(row.ashedMemberId),
    oauthIdentitySplit: oauthSplits.has(row.ashedMemberId),
  }));

  for (const memberRow of memberRows) {
    const indexRow = rows.find(
      (r) => r.ashedMemberId === memberRow.ashedMemberId,
    );
    if (indexRow) {
      indexRow.allianceRankTitle = memberRow.allianceRankTitle ?? null;
    }
  }

  return {
    seasonKey,
    rows,
    summaryBySquad: summarizeByMainSquad(teamRows),
    canEdit,
    canSelfReportMemberIds: ownedMemberIds,
  };
}
