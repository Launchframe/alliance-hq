import "server-only";

import { and, eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { emitMemberLinkClaimConflictAlert } from "@/lib/events/admin-alerts";
import { isValidGameUid, isClaimInviteMirrorDevUid, lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import { findAcceptedClaimInviteForUser } from "@/lib/native-alliance/invites";
import {
  getHqMemberLinkForUser,
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import { recordMemberLinkHelpRequest } from "@/lib/member-link/member-link-help-queue.server";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import { createMemberLinkTranslator } from "@/lib/member-link/translate.server";
import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";
import { getAllianceById, getLinkedMemberIds } from "@/lib/vr/repository";
import { namesMatch } from "@/lib/vr/link-helpers";

export type MemberLinkClaimTarget = {
  ashedMemberId: string;
  commanderName: string;
};

type MemberLinkClaimTargetRecord = MemberLinkClaimTarget & {
  previousNames: string[];
};

/**
 * Commander a recipient was invited to claim, if they accepted a claim invite
 * and have not yet linked. Loads roster names only (never the UID).
 */
async function loadMemberLinkClaimTarget(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MemberLinkClaimTargetRecord | null> {
  const existingLink = await getHqMemberLinkForUser(
    input.allianceId,
    input.hqUserId,
  );
  if (existingLink) return null;

  const claim = await findAcceptedClaimInviteForUser(
    input.allianceId,
    input.hqUserId,
  );
  if (!claim) return null;

  const db = getDb();
  const [member] = await db
    .select({
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, claim.targetAshedMemberId),
      ),
    )
    .limit(1);

  if (!member || member.status === "former") return null;

  return {
    ashedMemberId: claim.targetAshedMemberId,
    commanderName: member.currentName,
    previousNames: member.previousNamesJson ?? [],
  };
}

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

function claimTargetMatchesLookupName(
  target: MemberLinkClaimTargetRecord,
  gameUserName: string,
): boolean {
  return [target.commanderName, ...target.previousNames].some((name) =>
    namesMatch(name, gameUserName),
  );
}

async function findClaimedNameCollision(input: {
  allianceId: string;
  gameUserName: string;
  targetAshedMemberId: string;
}): Promise<string | null> {
  const db = getDb();
  const [linkedIds, members] = await Promise.all([
    getLinkedMemberIds(input.allianceId),
    db
      .select({
        ashedMemberId: schema.allianceMembers.ashedMemberId,
        currentName: schema.allianceMembers.currentName,
        previousNamesJson: schema.allianceMembers.previousNamesJson,
      })
      .from(schema.allianceMembers)
      .where(eq(schema.allianceMembers.allianceId, input.allianceId)),
  ]);

  for (const member of members) {
    if (member.ashedMemberId === input.targetAshedMemberId) continue;
    if (!linkedIds.has(member.ashedMemberId)) continue;

    const names = [member.currentName, ...(member.previousNamesJson ?? [])];
    if (names.some((name) => namesMatch(name, input.gameUserName))) {
      return member.currentName;
    }
  }

  return null;
}

type ClaimConflictReason =
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
async function surfaceClaimConflict(input: {
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

  const nameMatches = claimTargetMatchesLookupName(target, lookupGameUserName);
  const collisionName = await findClaimedNameCollision({
    allianceId: input.allianceId,
    gameUserName: lookupGameUserName,
    targetAshedMemberId: target.ashedMemberId,
  });

  // Name mismatches are non-blocking: link the claim target, keep the roster
  // name for now, and queue officer review to pick roster vs Last War name.
  // Only a UID already claimed by another HQ user blocks completion.
  const linked = await linkHqMember({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId: target.ashedMemberId,
    memberDisplayName: nameMatches
      ? lookupGameUserName
      : target.commanderName,
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

  if (nameMatches && !collisionName) {
    await reconcileAllianceMemberForRosterLink({
      allianceId: input.allianceId,
      ashedMemberId: target.ashedMemberId,
      gameUserName: lookupGameUserName,
    });
  } else {
    const reason = !nameMatches ? "target_mismatch" : "name_collision";
    await surfaceClaimConflict({
      allianceId: input.allianceId,
      allianceTag,
      hqUserId: input.hqUserId,
      handle,
      commanderName: target.commanderName,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      ashedMemberId: target.ashedMemberId,
      reason,
    });
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      allianceId: input.allianceId,
      action: "member_link.claim_name_review",
      metadata: {
        ashedMemberId: target.ashedMemberId,
        reason,
      },
    });
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
