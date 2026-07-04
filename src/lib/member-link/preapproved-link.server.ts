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
import { findAcceptedClaimInviteForUser } from "@/lib/native-alliance/invites";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import { getDb, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { namesMatch } from "@/lib/vr/link-helpers";
import { getAllianceById, getLinkedMemberIds } from "@/lib/vr/repository";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import { isClaimInviteMirrorDevUid } from "@/lib/lastwar/player-lookup";

export type PreApprovedLinkTarget = {
  ashedMemberId: string;
  memberDisplayName: string;
  gameUid: string;
  source: "hq_member_link" | "claim_invite";
};

type ClaimTargetRecord = {
  ashedMemberId: string;
  commanderName: string;
  previousNames: string[];
};

async function loadClaimTarget(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<ClaimTargetRecord | null> {
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

function claimTargetMatchesLookupName(
  target: ClaimTargetRecord,
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
}): Promise<boolean> {
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
      return true;
    }
  }
  return false;
}

async function notifyClaimConflict(input: {
  allianceId: string;
  hqUserId: string;
  requesterHandle?: string | null;
  claimTarget: ClaimTargetRecord;
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
    commanderName: input.claimTarget.commanderName,
    gameUserName: input.gameUserName,
    gameUid: input.gameUid,
    ashedMemberId: input.claimTarget.ashedMemberId,
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

  const claimTarget = await loadClaimTarget({
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
      claimTarget,
      gameUserName: lookupGameUserName,
      gameUid: uid,
      reason: "target_mismatch",
    });
    return { ok: false, reason: "claim_conflict" };
  }

  if (
    await findClaimedNameCollision({
      allianceId: input.allianceId,
      gameUserName: lookupGameUserName,
      targetAshedMemberId: claimTarget.ashedMemberId,
    })
  ) {
    await notifyClaimConflict({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      requesterHandle: input.requesterHandle,
      claimTarget,
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
