import "server-only";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitMemberLinkClaimConflictAlert } from "@/lib/events/admin-alerts";
import { isValidGameUid, isClaimInviteMirrorDevUid, lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import {
  claimTargetMatchesLookupName,
  findClaimedNameCollision,
  loadMemberLinkClaimTarget,
} from "@/lib/member-link/claim-target.server";
import {
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import { recordMemberLinkHelpRequest } from "@/lib/member-link/member-link-help-queue.server";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import { createMemberLinkTranslator } from "@/lib/member-link/translate.server";
import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";
import { getAllianceById } from "@/lib/vr/repository";

export type MemberLinkClaimTarget = {
  ashedMemberId: string;
  commanderName: string;
};

/**
 * Public claim target for the onboarding UI. Returns the display name only
 * (never UID or internal roster history).
 */
export async function getMemberLinkClaimTarget(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MemberLinkClaimTarget | null> {
  const target = await loadMemberLinkClaimTarget(input);
  if (!target) return null;
  return {
    ashedMemberId: target.ashedMemberId,
    commanderName: target.commanderName,
  };
}

/**
 * Blocks name+UID self-service while a commander claim invite is accepted but
 * not yet linked — officers bound a specific roster commander to this invite.
 */
export async function blockSelfServiceWhenClaimPending(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
}): Promise<MemberLinkApiResponse | null> {
  const target = await loadMemberLinkClaimTarget({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
  });
  if (!target) return null;

  const translate = createMemberLinkTranslator(input.locale);
  return {
    outcome: "usage",
    message: translate("claimSelfServiceBlocked"),
    pending: null,
  };
}

export type ClaimConflictReason =
  | "name_collision"
  | "commander_taken"
  /** @deprecated Legacy help rows only — claim confirm no longer emits this. */
  | "server_mismatch"
  | "target_mismatch";

/**
 * Surface a claim conflict to alliance officers two ways: a live admin alert
 * (real-time, ephemeral) AND a durable "ask an officer" help request so the
 * conflict still shows up in the officer review queue + inbox after the fact.
 * Without the persisted request the claimant-facing "officers notified" copy
 * would be a lie whenever no officer is connected to the live stream.
 */
export async function surfaceClaimConflict(input: {
  allianceId: string;
  allianceTag: string;
  hqUserId: string;
  handle: string;
  commanderName: string;
  gameUserName: string | null;
  gameUid: string;
  ashedMemberId: string;
  reason: ClaimConflictReason;
}): Promise<void> {
  await emitMemberLinkClaimConflictAlert({
    allianceId: input.allianceId,
    allianceTag: input.allianceTag,
    ashedMemberId: input.ashedMemberId,
    hqUserId: input.hqUserId,
    handle: input.handle,
    reason: input.reason,
  });

  try {
    await recordMemberLinkHelpRequest({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      origin: "web",
      context: "claim_conflict",
      requesterHandle: input.handle,
      reportedName: input.commanderName,
      gameUid: input.gameUid,
      gameUserName: input.gameUserName,
      targetAshedMemberId: input.ashedMemberId,
      claimConflictReason: input.reason,
    });
  } catch (error) {
    console.error("[member-link] claim conflict help request failed", error);
  }
}

/**
 * Confirm a commander claim invite by UID. Populates the bound commander record
 * (gameUid, currentName, previous names) and links the recipient. Surfaces
 * conflicts (name collisions, already-claimed races, invite/name mismatch) to
 * alliance officers and platform maintainers instead of silently linking.
 */
export async function runWebMemberLinkClaimConfirm(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  gameUid: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<MemberLinkApiResponse> {
  const translate = createMemberLinkTranslator(input.locale);
  const handle =
    input.displayName?.trim() || input.userEmail?.trim() || input.hqUserId;

  const target = await loadMemberLinkClaimTarget({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
  });
  if (!target) {
    return {
      outcome: "usage",
      message: translate("errors.nothingPending"),
      pending: null,
    };
  }

  const uid = input.gameUid.trim();
  if (!isValidGameUid(uid)) {
    return {
      outcome: "usage",
      message: translate("claimUidInvalid"),
      pending: null,
    };
  }

  const lookup = await lookupPlayerByUid(uid);
  if (!lookup.ok) {
    return {
      outcome: "lookup_error",
      message: lookup.message,
      pending: null,
    };
  }

  const alliance = await getAllianceById(input.allianceId);
  const allianceTag = alliance?.tag ?? "alliance";

  const lookupGameUserName = isClaimInviteMirrorDevUid(uid)
    ? target.commanderName
    : lookup.gameUserName;

  if (!claimTargetMatchesLookupName(target, lookupGameUserName)) {
    await surfaceClaimConflict({
      allianceId: input.allianceId,
      allianceTag,
      hqUserId: input.hqUserId,
      handle,
      commanderName: target.commanderName,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      ashedMemberId: target.ashedMemberId,
      reason: "target_mismatch",
    });
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      allianceId: input.allianceId,
      action: "member_link.claim_conflict",
      metadata: {
        ashedMemberId: target.ashedMemberId,
        reason: "target_mismatch",
      },
    });
    return {
      outcome: "claim_conflict",
      message: translate("claimConflict"),
      pending: null,
    };
  }

  const collisionName = await findClaimedNameCollision({
    allianceId: input.allianceId,
    gameUserName: lookupGameUserName,
    targetAshedMemberId: target.ashedMemberId,
  });
  if (collisionName) {
    await surfaceClaimConflict({
      allianceId: input.allianceId,
      allianceTag,
      hqUserId: input.hqUserId,
      handle,
      commanderName: target.commanderName,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      ashedMemberId: target.ashedMemberId,
      reason: "name_collision",
    });
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      allianceId: input.allianceId,
      action: "member_link.claim_conflict",
      metadata: {
        ashedMemberId: target.ashedMemberId,
        reason: "name_collision",
      },
    });
    return {
      outcome: "claim_conflict",
      message: translate("claimConflict"),
      pending: null,
    };
  }

  // Populate the bound commander record with the authoritative Last War name
  // (currentName + previous-names history) before linking.
  await reconcileAllianceMemberForRosterLink({
    allianceId: input.allianceId,
    ashedMemberId: target.ashedMemberId,
    gameUserName: lookupGameUserName,
  });

  const linked = await linkHqMember({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId: target.ashedMemberId,
    memberDisplayName: lookupGameUserName,
    gameUid: uid,
  });

  if (!linked.ok) {
    await surfaceClaimConflict({
      allianceId: input.allianceId,
      allianceTag,
      hqUserId: input.hqUserId,
      handle,
      commanderName: target.commanderName,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      ashedMemberId: target.ashedMemberId,
      reason: "commander_taken",
    });
    return {
      outcome: "claim_conflict",
      message: translate("claimConflict"),
      pending: null,
    };
  }

  try {
    await maybeSetOwnerMemberExternalId({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      ashedMemberId: target.ashedMemberId,
    });
  } catch (error) {
    console.error("[member-link] claim owner externalId sync failed", error);
  }

  await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
  await syncPrimaryGameUidFromHqMemberLink(input.hqUserId, uid);

  if (lookup.gameUserLevel != null) {
    try {
      await syncAllianceMemberGameLevelFromLastWar({
        allianceId: input.allianceId,
        ashedMemberId: target.ashedMemberId,
        gameUserLevel: lookup.gameUserLevel,
      });
    } catch (error) {
      console.error("[member-link] claim level sync failed", error);
    }
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    hqUserId: input.hqUserId,
    allianceId: input.allianceId,
    action: "member_link.claim_confirmed",
    metadata: { ashedMemberId: target.ashedMemberId },
  });

  return {
    outcome: "linked",
    message: translate("link.linked", { name: lookupGameUserName }),
    pending: null,
    linkedMemberName: lookupGameUserName,
  };
}
