import "server-only";

import { and, eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { emitMemberLinkClaimConflictAlert } from "@/lib/events/admin-alerts";
import { isValidGameUid, lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import { findAcceptedClaimInviteForUser } from "@/lib/native-alliance/invites";
import {
  getHqMemberLinkForUser,
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import { createMemberLinkTranslator } from "@/lib/member-link/translate.server";
import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
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

/**
 * Confirm a commander claim invite by UID. Populates the bound commander record
 * (gameUid, currentName, previous names) and links the recipient. Surfaces
 * conflicts (name collisions, already-claimed races, server mismatch) to
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

  const allianceServer = await resolveAllianceGameServerNumber(input.allianceId);
  const playerServer = lookup.gameServerNumber ?? null;
  if (
    allianceServer != null &&
    playerServer != null &&
    playerServer !== allianceServer
  ) {
    await emitMemberLinkClaimConflictAlert({
      allianceId: input.allianceId,
      allianceTag,
      ashedMemberId: target.ashedMemberId,
      hqUserId: input.hqUserId,
      handle,
      reason: "server_mismatch",
    });
    return {
      outcome: "claim_conflict",
      message: translate("claimConflict"),
      pending: null,
    };
  }

  if (!claimTargetMatchesLookupName(target, lookup.gameUserName)) {
    await emitMemberLinkClaimConflictAlert({
      allianceId: input.allianceId,
      allianceTag,
      ashedMemberId: target.ashedMemberId,
      hqUserId: input.hqUserId,
      handle,
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
    gameUserName: lookup.gameUserName,
    targetAshedMemberId: target.ashedMemberId,
  });
  if (collisionName) {
    await emitMemberLinkClaimConflictAlert({
      allianceId: input.allianceId,
      allianceTag,
      ashedMemberId: target.ashedMemberId,
      hqUserId: input.hqUserId,
      handle,
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
    gameUserName: lookup.gameUserName,
  });

  const linked = await linkHqMember({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId: target.ashedMemberId,
    memberDisplayName: lookup.gameUserName,
    gameUid: uid,
  });

  if (!linked.ok) {
    await emitMemberLinkClaimConflictAlert({
      allianceId: input.allianceId,
      allianceTag,
      ashedMemberId: target.ashedMemberId,
      hqUserId: input.hqUserId,
      handle,
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
    message: translate("link.linked", { name: lookup.gameUserName }),
    pending: null,
    linkedMemberName: lookup.gameUserName,
  };
}
