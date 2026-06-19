import "server-only";

import type { MembersApiContext } from "@/lib/members/members-api-context";
import type { BulkMemberRankAction } from "@/lib/members/bulk-rank-update.shared";
import {
  clearMemberRankOnAshed,
  confirmMemberRank,
  confirmMemberRankLocal,
} from "@/lib/trains/rank-sync";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { AshedMember } from "@/lib/video/member-matcher";
import {
  clearAllianceMemberRank,
} from "@/lib/members/roster.server";

export type BulkMemberRankInput = {
  memberIds: string[];
  action: BulkMemberRankAction;
  /** Required when action is set — R1–R4 for bulk roster tagging (no officer title). */
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
  const isNative = input.ctx.operatingMode === "native";

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
        if (isNative) {
          await clearAllianceMemberRank({
            hqAllianceId: input.ctx.hqAllianceId,
            ashedMemberId,
          });
        } else if (input.ctx.connection) {
          await clearMemberRankOnAshed(
            input.ctx.connection,
            ashedMemberId,
            input.ctx.hqAllianceId,
          );
        }
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

      if (isNative) {
        await confirmMemberRankLocal({
          allianceId: input.ctx.hqAllianceId,
          ashedMemberId,
          memberName,
          allianceRank,
          allianceRankTitle: null,
          effectiveDate,
          source: "manual",
          recordedByHqUserId: input.recordedByHqUserId ?? null,
        });
      } else if (input.ctx.connection) {
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
      }

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
