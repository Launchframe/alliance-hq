import "server-only";

import {
  emitMemberLinkClaimConflictAlert,
  emitMemberLinkUidTakenAlert,
} from "@/lib/events/admin-alerts";
import { describeGameUidClaimConflict } from "@/lib/member-link/link-claim-guards.shared";
import { recordMemberLinkHelpRequest } from "@/lib/member-link/member-link-help-queue.server";
import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";
import { loadGameUidClaimsForAlliance } from "@/lib/member-link/repository.server";
import { createMemberLinkTranslator } from "@/lib/member-link/translate.server";

function resolveConflictAshedMemberId(input: {
  ashedMemberId: string;
  hqUserId: string;
  hqClaims: Array<{ hqUserId: string; ashedMemberId: string }>;
  discordClaims: Array<{
    discordUserId: string;
    ashedMemberId: string;
    hqUserId: string | null;
  }>;
}): string {
  const trimmed = input.ashedMemberId.trim();
  if (trimmed) return trimmed;
  if (input.discordClaims[0]) return input.discordClaims[0].ashedMemberId;
  if (input.hqClaims[0]) return input.hqClaims[0].ashedMemberId;
  return trimmed;
}

export async function surfaceWebMemberLinkTakenConflict(input: {
  allianceId: string;
  allianceTag: string;
  hqUserId: string;
  handle: string;
  locale: string;
  gameUid: string;
  ashedMemberId: string;
  gameUserName?: string | null;
  reportedName?: string | null;
}): Promise<MemberLinkApiResponse> {
  const translate = createMemberLinkTranslator(input.locale);
  const { hqClaims, discordClaims } = await loadGameUidClaimsForAlliance(
    input.allianceId,
    input.gameUid,
  );
  const ashedMemberId = resolveConflictAshedMemberId({
    ashedMemberId: input.ashedMemberId,
    hqUserId: input.hqUserId,
    hqClaims,
    discordClaims,
  });
  const conflictKind = describeGameUidClaimConflict({
    hqUserId: input.hqUserId,
    ashedMemberId,
    hqClaims,
    discordClaims,
  });

  try {
    await emitMemberLinkUidTakenAlert({
      allianceId: input.allianceId,
      allianceTag: input.allianceTag,
      ashedMemberId,
      hqUserId: input.hqUserId,
      handle: input.handle,
    });
  } catch (error) {
    console.error("[member-link] uid-taken admin alert failed", error);
  }

  if (conflictKind === "discord_only") {
    try {
      await emitMemberLinkClaimConflictAlert({
        allianceId: input.allianceId,
        allianceTag: input.allianceTag,
        ashedMemberId,
        hqUserId: input.hqUserId,
        handle: input.handle,
        reason: "discord_hq_unlinked",
      });
      await recordMemberLinkHelpRequest({
        allianceId: input.allianceId,
        hqUserId: input.hqUserId,
        origin: "web",
        context: "cross_layer_claim",
        requesterHandle: input.handle,
        reportedName: input.reportedName ?? null,
        gameUid: input.gameUid,
        gameUserName: input.gameUserName ?? null,
        targetAshedMemberId: ashedMemberId,
        claimConflictReason: "discord_hq_unlinked",
      });
    } catch (error) {
      console.error("[member-link] cross-layer claim help request failed", error);
    }

    return {
      outcome: "officer_notified",
      message: translate("crossLayerDiscordFirst"),
      pending: null,
    };
  }

  if (conflictKind === "hq_other_user" || conflictKind === "discord_other_hq") {
    try {
      await emitMemberLinkClaimConflictAlert({
        allianceId: input.allianceId,
        allianceTag: input.allianceTag,
        ashedMemberId,
        hqUserId: input.hqUserId,
        handle: input.handle,
        reason: "commander_taken",
      });
      await recordMemberLinkHelpRequest({
        allianceId: input.allianceId,
        hqUserId: input.hqUserId,
        origin: "web",
        context: "claim_conflict",
        requesterHandle: input.handle,
        reportedName: input.reportedName ?? null,
        gameUid: input.gameUid,
        gameUserName: input.gameUserName ?? null,
        targetAshedMemberId: ashedMemberId,
        claimConflictReason: "commander_taken",
      });
    } catch (error) {
      console.error("[member-link] member-taken help request failed", error);
    }

    return {
      outcome: "member_taken",
      message: translate("memberTakenEscalated"),
      pending: null,
    };
  }

  return {
    outcome: "member_taken",
    message: translate("memberTaken"),
    pending: null,
  };
}
