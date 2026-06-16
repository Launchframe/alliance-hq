import "server-only";

import type { MembersApiContext } from "@/lib/members/members-api-context";
import type { BulkMemberRankAction } from "@/lib/members/bulk-rank-update.shared";
import {
  clearMemberRankOnAshed,
  confirmMemberRank,
} from "@/lib/trains/rank-sync";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { AshedMember } from "@/lib/video/member-matcher";

export type BulkMemberRankInput = {
  memberIds: string[];
  action: BulkMemberRankAction;
  /** Required when action is set — R1, R2, or R3 only for bulk roster tagging. */
  allianceRank?: number;
  membersById: Map<string, AshedMember>;
  ctx: MembersApiContext;
  recordedByHqUserId?: string | null;
};

export type BulkMemberRankItemResult = {
  ashedMemberId: string;
  memberName: string;
  ok: boolean;
  error?: string;
};

export type BulkMemberRankOutput = {
  results: BulkMemberRankItemResult[];
  updated: number;
};

export async function applyBulkMemberRanks(
  input: BulkMemberRankInput,
): Promise<BulkMemberRankOutput> {
  const effectiveDate = getServerCalendarDate();
  const results: BulkMemberRankItemResult[] = [];

  for (const ashedMemberId of input.memberIds) {
    const member = input.membersById.get(ashedMemberId);
    if (!member) {
      results.push({
        ashedMemberId,
        memberName: ashedMemberId,
        ok: false,
        error: "Member not found in roster.",
      });
      continue;
    }

    const memberName = member.current_name;

    try {
      if (input.action === "clear") {
        await clearMemberRankOnAshed(
          input.ctx.connection,
          ashedMemberId,
          input.ctx.hqAllianceId,
        );
        results.push({ ashedMemberId, memberName, ok: true });
        continue;
      }

      const allianceRank = input.allianceRank;
      if (allianceRank == null) {
        results.push({
          ashedMemberId,
          memberName,
          ok: false,
          error: "Missing alliance rank.",
        });
        continue;
      }

      await confirmMemberRank({
        allianceId: input.ctx.hqAllianceId,
        ashedMemberId,
        memberName,
        allianceRank,
        allianceRankTitle: null,
        effectiveDate,
        source: "manual",
        recordedByHqUserId: input.recordedByHqUserId ?? null,
        connection: input.ctx.connection,
      });
      results.push({ ashedMemberId, memberName, ok: true });
    } catch (error) {
      results.push({
        ashedMemberId,
        memberName,
        ok: false,
        error: error instanceof Error ? error.message : "Update failed.",
      });
    }
  }

  return {
    results,
    updated: results.filter((r) => r.ok).length,
  };
}
