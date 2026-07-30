import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { MemberVsComplianceEvent } from "@/lib/db/schema";
import type { MembersApiContext } from "@/lib/members/members-api-context";
import { markAllianceMemberFormer } from "@/lib/members/roster.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { resolveMemberAllianceRankAsOf } from "@/lib/trains/rank-history";
import {
  confirmMemberRank,
  confirmMemberRankLocal,
} from "@/lib/trains/rank-sync";
import {
  VS_DEMOTION_TASK_KIND,
  VS_KICK_TASK_KIND,
  vsComplianceTaskKindForStrike,
} from "@/lib/vs-compliance/evaluate.shared";
import { demotedAllianceRank } from "@/lib/vs-compliance/vs-compliance-enforcement.shared";

export async function enforceVsComplianceTaskOnComplete(input: {
  event: MemberVsComplianceEvent;
  allianceId: string;
  hqUserId: string;
  missStrikesBeforeKick: number;
  membersCtx: MembersApiContext;
}): Promise<void> {
  const strikeNumber = input.event.strikeNumber ?? 0;
  const taskKind = vsComplianceTaskKindForStrike(
    strikeNumber,
    input.missStrikesBeforeKick,
  );

  if (taskKind === VS_DEMOTION_TASK_KIND) {
    await enforceVsComplianceDemotion({
      allianceId: input.allianceId,
      ashedMemberId: input.event.ashedMemberId,
      memberName: input.event.memberName,
      hqUserId: input.hqUserId,
      membersCtx: input.membersCtx,
    });
    return;
  }

  if (taskKind === VS_KICK_TASK_KIND) {
    await enforceVsComplianceKick({
      allianceId: input.allianceId,
      ashedMemberId: input.event.ashedMemberId,
    });
  }
}

async function loadActiveAllianceMember(input: {
  allianceId: string;
  ashedMemberId: string;
}) {
  const [member] = await getDb()
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!member) {
    throw new Error("Member not found on roster.");
  }
  if (member.status === "former") {
    throw new Error("Member is already inactive.");
  }
  return member;
}

export async function enforceVsComplianceDemotion(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  hqUserId: string;
  membersCtx: MembersApiContext;
}): Promise<void> {
  const member = await loadActiveAllianceMember({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
  });

  const effectiveDate = getServerCalendarDate();
  const resolved = await resolveMemberAllianceRankAsOf(
    input.allianceId,
    input.ashedMemberId,
    effectiveDate,
    member.allianceRank,
    member.allianceRankTitle,
  );

  if (resolved.rank == null) {
    throw new Error("Member rank is unknown — set rank before demoting.");
  }

  const nextRank = demotedAllianceRank(resolved.rank);
  if (nextRank == null) {
    throw new Error("Member is already at the lowest rank (R1).");
  }

  const rankInput = {
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    allianceRank: nextRank,
    allianceRankTitle: null,
    effectiveDate,
    source: "manual" as const,
    recordedByHqUserId: input.hqUserId,
  };

  if (input.membersCtx.operatingMode === "native") {
    await confirmMemberRankLocal(rankInput);
    return;
  }

  if (!input.membersCtx.connection) {
    throw new Error("Not connected to Ashed.");
  }

  await confirmMemberRank({
    ...rankInput,
    connection: input.membersCtx.connection,
  });
}

export async function enforceVsComplianceKick(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<void> {
  const member = await loadActiveAllianceMember({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
  });

  await markAllianceMemberFormer({
    hqAllianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    gameUid: member.gameUid,
  });
}
