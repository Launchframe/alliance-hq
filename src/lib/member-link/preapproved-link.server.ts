import "server-only";

import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import {
  getHqMemberLinkForUser,
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import {
  type ClaimConflictReason,
  surfaceClaimConflict,
} from "@/lib/member-link/claim.server";
import {
  claimTargetMatchesLookupName,
  findClaimedNameCollision,
  loadMemberLinkClaimTarget,
} from "@/lib/member-link/claim-target.server";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import { getAllianceById } from "@/lib/vr/repository";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import { isClaimInviteMirrorDevUid } from "@/lib/lastwar/player-lookup";

export type PreApprovedLinkTarget = {
  ashedMemberId: string;
  memberDisplayName: string;
  gameUid: string;
  source: "hq_member_link" | "claim_invite";
};

async function notifyClaimConflict(input: {
  allianceId: string;
  hqUserId: string;
  requesterHandle?: string | null;
  commanderName: string;
  ashedMemberId: string;
  gameUserName: string;
  gameUid: string;
  reason: ClaimConflictReason;
}): Promise<void> {
  const handle = input.requesterHandle?.trim() || input.hqUserId;
  const alliance = await getAllianceById(input.allianceId);
  await surfaceClaimConflict({
    allianceId: input.allianceId,
    allianceTag: alliance?.tag ?? "alliance",
    hqUserId: input.hqUserId,
    handle,
    commanderName: input.commanderName,
    gameUserName: input.gameUserName,
    gameUid: input.gameUid,
    ashedMemberId: input.ashedMemberId,
    reason: input.reason,
  });
}

/**
 * Resolve a commander link that officers already approved: either the HQ user
 * already linked this UID on the web, or they accepted a commander claim invite.
 *
 * For claim invites, applies the HQ member link (same as claim confirm). For an
 * existing HQ link, returns the target so Discord can mirror it without a second
 * owner-approval pass.
 */
export async function tryPreApprovedMemberLink(input: {
  allianceId: string;
  hqUserId: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  requesterHandle?: string | null;
}): Promise<
  | { ok: true; target: PreApprovedLinkTarget }
  | { ok: false; reason: "not_preapproved" | "claim_conflict" | "commander_taken" }
> {
  const uid = input.gameUid.trim();
  if (!uid) {
    return { ok: false, reason: "not_preapproved" };
  }

  const existing = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (existing && existing.gameUid.trim() === uid) {
    return {
      ok: true,
      target: {
        ashedMemberId: existing.ashedMemberId,
        memberDisplayName:
          existing.memberDisplayName?.trim() || input.lookup.gameUserName,
        gameUid: uid,
        source: "hq_member_link",
      },
    };
  }

  const claimTarget = await loadMemberLinkClaimTarget({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
  });
  if (!claimTarget) {
    return { ok: false, reason: "not_preapproved" };
  }

  const lookupGameUserName = isClaimInviteMirrorDevUid(uid)
    ? claimTarget.commanderName
    : input.lookup.gameUserName;

  if (!claimTargetMatchesLookupName(claimTarget, lookupGameUserName)) {
    await notifyClaimConflict({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      requesterHandle: input.requesterHandle,
      commanderName: claimTarget.commanderName,
      ashedMemberId: claimTarget.ashedMemberId,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      reason: "target_mismatch",
    });
    return { ok: false, reason: "claim_conflict" };
  }

  if (
    (await findClaimedNameCollision({
      allianceId: input.allianceId,
      gameUserName: lookupGameUserName,
      targetAshedMemberId: claimTarget.ashedMemberId,
    })) != null
  ) {
    await notifyClaimConflict({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      requesterHandle: input.requesterHandle,
      commanderName: claimTarget.commanderName,
      ashedMemberId: claimTarget.ashedMemberId,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      reason: "name_collision",
    });
    return { ok: false, reason: "claim_conflict" };
  }

  await reconcileAllianceMemberForRosterLink({
    allianceId: input.allianceId,
    ashedMemberId: claimTarget.ashedMemberId,
    gameUserName: lookupGameUserName,
  });

  const linked = await linkHqMember({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId: claimTarget.ashedMemberId,
    memberDisplayName: lookupGameUserName,
    gameUid: uid,
  });

  if (!linked.ok) {
    return { ok: false, reason: "commander_taken" };
  }

  try {
    await maybeSetOwnerMemberExternalId({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      ashedMemberId: claimTarget.ashedMemberId,
    });
  } catch (error) {
    console.error("[member-link] preapproved claim owner sync failed", error);
  }

  await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
  await syncPrimaryGameUidFromHqMemberLink(input.hqUserId, uid);

  if (input.lookup.gameUserLevel != null) {
    try {
      await syncAllianceMemberGameLevelFromLastWar({
        allianceId: input.allianceId,
        ashedMemberId: claimTarget.ashedMemberId,
        gameUserLevel: input.lookup.gameUserLevel,
      });
    } catch (error) {
      console.error("[member-link] preapproved claim level sync failed", error);
    }
  }

  return {
    ok: true,
    target: {
      ashedMemberId: claimTarget.ashedMemberId,
      memberDisplayName: lookupGameUserName,
      gameUid: uid,
      source: "claim_invite",
    },
  };
}
