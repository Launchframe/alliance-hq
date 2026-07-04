import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import {
  getMemberLinkHelpRequestById,
  resolveMemberLinkHelpRequest,
  satisfyHelpInboxItem,
} from "@/lib/member-link/member-link-help-queue.server";
import {
  getHqMemberLinkByAllianceAndMember,
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import { unlinkCommanderHqAccount } from "@/lib/member-link/unlink.server";
import { normalizeName } from "@/lib/vr/link-helpers";
import { getLinkedMemberIds } from "@/lib/vr/repository";
import {
  helpRequestRosterNameNeedles,
  type HelpRequestClaimContact,
  type HelpRequestRosterRow,
  type MemberLinkClaimConflictReason,
  type MemberLinkHelpRequestReview,
} from "@/lib/member-link/member-link-help-review.shared";

function rosterNameMatches(
  member: { currentName: string; previousNamesJson: unknown },
  needles: string[],
): boolean {
  const normalizedNeedles = needles
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeName);
  if (normalizedNeedles.length === 0) return false;

  const names = [
    member.currentName,
    ...(Array.isArray(member.previousNamesJson)
      ? (member.previousNamesJson as string[])
      : []),
  ];
  return names.some((name) =>
    normalizedNeedles.includes(normalizeName(String(name))),
  );
}

async function loadClaimMaps(allianceId: string): Promise<{
  linkedIds: Set<string>;
  hqByMember: Map<string, HelpRequestClaimContact>;
  discordByMember: Map<string, { username: string | null }>;
}> {
  const db = getDb();
  const [hqRows, discordRows] = await Promise.all([
    db
      .select({
        ashedMemberId: schema.hqMemberLinks.ashedMemberId,
        memberDisplayName: schema.hqMemberLinks.memberDisplayName,
        email: schema.hqUsers.email,
        displayName: schema.hqUsers.displayName,
      })
      .from(schema.hqMemberLinks)
      .innerJoin(
        schema.hqUsers,
        eq(schema.hqUsers.id, schema.hqMemberLinks.hqUserId),
      )
      .where(eq(schema.hqMemberLinks.allianceId, allianceId)),
    db
      .select({
        ashedMemberId: schema.discordMemberLinks.ashedMemberId,
        discordUsername: schema.discordMemberLinks.discordUsername,
      })
      .from(schema.discordMemberLinks)
      .where(eq(schema.discordMemberLinks.allianceId, allianceId)),
  ]);

  const linkedIds = await getLinkedMemberIds(allianceId);
  const hqByMember = new Map<string, HelpRequestClaimContact>();
  for (const row of hqRows) {
    hqByMember.set(row.ashedMemberId, {
      email: row.email,
      displayName: row.displayName,
      memberDisplayName: row.memberDisplayName,
    });
  }
  const discordByMember = new Map<string, { username: string | null }>();
  for (const row of discordRows) {
    discordByMember.set(row.ashedMemberId, {
      username: row.discordUsername,
    });
  }
  return { linkedIds, hqByMember, discordByMember };
}

function buildRosterRow(
  member: {
    ashedMemberId: string;
    currentName: string;
    previousNamesJson: unknown;
  },
  linkedIds: Set<string>,
  hqByMember: Map<string, HelpRequestClaimContact>,
  discordByMember: Map<string, { username: string | null }>,
  nameNeedles: string[],
): HelpRequestRosterRow {
  const claimed = linkedIds.has(member.ashedMemberId);
  const hq = hqByMember.get(member.ashedMemberId);
  const discord = discordByMember.get(member.ashedMemberId);
  return {
    ashedMemberId: member.ashedMemberId,
    currentName: member.currentName,
    nameMatchHint: rosterNameMatches(member, nameNeedles),
    claim: claimed
      ? { hq: hq ?? undefined, discord: discord ?? undefined }
      : null,
  };
}

export async function loadMemberLinkHelpRequestReview(input: {
  requestId: string;
  allianceId?: string;
}): Promise<MemberLinkHelpRequestReview | null> {
  const db = getDb();
  const row = await getMemberLinkHelpRequestById(input.requestId);
  if (!row) return null;
  if (input.allianceId && row.allianceId !== input.allianceId) return null;

  const [allianceRow] = await db
    .select({
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, row.allianceId))
    .limit(1);

  let requesterEmail: string | null = null;
  let requesterDisplayName: string | null = null;
  if (row.hqUserId) {
    const [userRow] = await db
      .select({
        email: schema.hqUsers.email,
        displayName: schema.hqUsers.displayName,
      })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, row.hqUserId))
      .limit(1);
    requesterEmail = userRow?.email ?? null;
    requesterDisplayName = userRow?.displayName ?? null;
  }

  const members = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, row.allianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    )
    .orderBy(schema.allianceMembers.currentName);

  const { linkedIds, hqByMember, discordByMember } = await loadClaimMaps(
    row.allianceId,
  );
  const nameNeedles = helpRequestRosterNameNeedles({
    context: row.context,
    reportedName: row.reportedName,
    gameUserName: row.gameUserName,
  });

  const rosterRows = members.map((member) =>
    buildRosterRow(
      member,
      linkedIds,
      hqByMember,
      discordByMember,
      nameNeedles,
    ),
  );

  const unclaimed: HelpRequestRosterRow[] = [];
  const claimed: HelpRequestRosterRow[] = [];
  for (const rosterRow of rosterRows) {
    if (linkedIds.has(rosterRow.ashedMemberId)) {
      claimed.push(rosterRow);
    } else {
      unclaimed.push(rosterRow);
    }
  }

  unclaimed.sort(
    (a, b) =>
      Number(b.nameMatchHint) - Number(a.nameMatchHint) ||
      a.currentName.localeCompare(b.currentName),
  );
  claimed.sort((a, b) => a.currentName.localeCompare(b.currentName));

  return {
    request: {
      id: row.id,
      allianceId: row.allianceId,
      allianceTag: allianceRow?.tag ?? null,
      allianceName: allianceRow?.name ?? null,
      origin: row.origin,
      context: row.context,
      claimConflictReason:
        (row.claimConflictReason as MemberLinkClaimConflictReason | null) ??
        null,
      reportedName: row.reportedName,
      gameUserName: row.gameUserName,
      gameUidLast4: row.gameUid ? row.gameUid.slice(-4) : null,
      status: row.status,
      inviteTargetAshedMemberId: row.linkedAshedMemberId ?? null,
      createdAt: row.createdAt,
      hqUserId: row.hqUserId,
      discordUsername: row.discordUsername,
      requesterHandle: row.requesterHandle,
    },
    requester: {
      email: requesterEmail,
      displayName: requesterDisplayName,
      discordUsername: row.discordUsername,
      requesterHandle: row.requesterHandle,
    },
    roster: { unclaimed, claimed },
  };
}

export async function loadClaimantContactForMember(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<{
  hq?: HelpRequestClaimContact;
  discord?: { username: string | null };
} | null> {
  const { hqByMember, discordByMember, linkedIds } = await loadClaimMaps(
    input.allianceId,
  );
  if (!linkedIds.has(input.ashedMemberId)) return null;
  const hq = hqByMember.get(input.ashedMemberId);
  const discord = discordByMember.get(input.ashedMemberId);
  if (!hq && !discord) return {};
  return { hq: hq ?? undefined, discord: discord ?? undefined };
}

/** Break-glass HQ unlink during officer help review (mediation). */
export async function unlinkHqMemberLinkBreakGlass(input: {
  requestId: string;
  targetAshedMemberId: string;
  sessionId: string;
  resolvedByHqUserId: string;
  allianceId?: string;
  notifiedClaimant: true;
}): Promise<
  | { ok: true; memberName: string }
  | { ok: false; reason: string }
> {
  const row = await getMemberLinkHelpRequestById(input.requestId);
  if (!row) return { ok: false, reason: "not_found" };
  if (input.allianceId && row.allianceId !== input.allianceId) {
    return { ok: false, reason: "not_found" };
  }
  if (row.status !== "open") return { ok: false, reason: "already_closed" };

  const db = getDb();
  const [memberRow] = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, row.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.targetAshedMemberId),
        ne(schema.allianceMembers.status, "former"),
      ),
    )
    .limit(1);
  if (!memberRow) return { ok: false, reason: "member_not_found" };

  const hqLink = await getHqMemberLinkByAllianceAndMember(
    row.allianceId,
    input.targetAshedMemberId,
  );
  if (!hqLink) {
    return { ok: false, reason: "not_linked" };
  }

  const unlinked = await unlinkCommanderHqAccount({
    sessionId: input.sessionId,
    actorHqUserId: input.resolvedByHqUserId,
    allianceId: row.allianceId,
    ashedMemberId: input.targetAshedMemberId,
  });
  if (!unlinked.ok) {
    return { ok: false, reason: unlinked.reason };
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    hqUserId: input.resolvedByHqUserId,
    allianceId: row.allianceId,
    action: "member_link_help_break_glass_unlink",
    resourceType: "hq_member_link_help_request",
    resourceId: input.requestId,
    metadata: {
      targetAshedMemberId: input.targetAshedMemberId,
      notifiedClaimant: input.notifiedClaimant,
      helpContext: row.context,
    },
  });

  return { ok: true, memberName: memberRow.currentName };
}

export async function linkMemberLinkHelpRequest(input: {
  requestId: string;
  targetAshedMemberId: string;
  resolvedByHqUserId: string;
  sessionId: string;
  allianceId?: string;
}): Promise<
  | { ok: true; memberName: string }
  | {
      ok: false;
      reason: string;
      claimant?: {
        hq?: HelpRequestClaimContact;
        discord?: { username: string | null };
      };
    }
> {
  const db = getDb();
  const row = await getMemberLinkHelpRequestById(input.requestId);
  if (!row) return { ok: false, reason: "not_found" };
  if (input.allianceId && row.allianceId !== input.allianceId) {
    return { ok: false, reason: "not_found" };
  }
  if (row.status !== "open") return { ok: false, reason: "already_closed" };
  if (!row.hqUserId) return { ok: false, reason: "hq_user_required" };
  if (!row.gameUid || !/^\d{12,16}$/.test(row.gameUid)) {
    return { ok: false, reason: "uid_required" };
  }

  const [memberRow] = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, row.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.targetAshedMemberId),
        ne(schema.allianceMembers.status, "former"),
      ),
    )
    .limit(1);
  if (!memberRow) return { ok: false, reason: "member_not_found" };

  const existingHqLink = await getHqMemberLinkByAllianceAndMember(
    row.allianceId,
    input.targetAshedMemberId,
  );
  if (existingHqLink) {
    const claimant = await loadClaimantContactForMember({
      allianceId: row.allianceId,
      ashedMemberId: input.targetAshedMemberId,
    });
    return {
      ok: false,
      reason: "member_already_claimed",
      claimant: claimant ?? undefined,
    };
  }

  const displayName = row.gameUserName?.trim() || row.reportedName?.trim() || null;
  if (displayName) {
    await reconcileAllianceMemberForRosterLink({
      allianceId: row.allianceId,
      ashedMemberId: input.targetAshedMemberId,
      gameUserName: displayName,
      ashedConnection: null,
    });
  }

  const linked = await linkHqMember({
    allianceId: row.allianceId,
    hqUserId: row.hqUserId,
    ashedMemberId: input.targetAshedMemberId,
    memberDisplayName: displayName,
    gameUid: row.gameUid,
  });

  if (!linked.ok) {
    const claimant = await loadClaimantContactForMember({
      allianceId: row.allianceId,
      ashedMemberId: input.targetAshedMemberId,
    });
    return {
      ok: false,
      reason: linked.reason,
      claimant: claimant ?? undefined,
    };
  }

  try {
    await maybeSetOwnerMemberExternalId({
      allianceId: row.allianceId,
      hqUserId: row.hqUserId,
      ashedMemberId: input.targetAshedMemberId,
    });
  } catch (error) {
    console.error("[member-link-help] owner externalId sync failed", error);
  }

  await syncPrimaryGameUidFromHqMemberLink(row.hqUserId, row.gameUid);

  await saveHqMemberLinkPending(row.allianceId, row.hqUserId, null);

  const now = new Date();
  await db
    .update(schema.hqMemberLinkHelpRequests)
    .set({
      status: "resolved",
      linkedAshedMemberId: input.targetAshedMemberId,
      resolvedAt: now,
      resolvedByHqUserId: input.resolvedByHqUserId,
      updatedAt: now,
    })
    .where(eq(schema.hqMemberLinkHelpRequests.id, input.requestId));

  await satisfyHelpInboxItem(input.requestId);

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: row.allianceId,
    action: "member_link_help_linked",
    resourceType: "hq_member_link_help_request",
    resourceId: input.requestId,
    metadata: {
      targetAshedMemberId: input.targetAshedMemberId,
      hqUserId: row.hqUserId,
    },
  });

  const [updatedMember] = await db
    .select({ currentName: schema.allianceMembers.currentName })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, row.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.targetAshedMemberId),
      ),
    )
    .limit(1);

  return { ok: true, memberName: updatedMember?.currentName ?? memberRow.currentName };
}

/**
 * After a non-blocking claim name mismatch, officer picks roster vs Last War name.
 * Member is already linked; this only settles which display name we persist.
 */
export async function resolveClaimNameReview(input: {
  requestId: string;
  chosen: "roster" | "lookup";
  resolvedByHqUserId: string;
  sessionId: string;
  allianceId?: string;
}): Promise<
  | { ok: true; memberName: string }
  | { ok: false; reason: string }
> {
  const row = await getMemberLinkHelpRequestById(input.requestId);
  if (!row) return { ok: false, reason: "not_found" };
  if (input.allianceId && row.allianceId !== input.allianceId) {
    return { ok: false, reason: "not_found" };
  }
  if (row.status !== "open") return { ok: false, reason: "already_closed" };
  if (row.context !== "claim_conflict") {
    return { ok: false, reason: "not_name_review" };
  }
  if (
    row.claimConflictReason !== "target_mismatch" &&
    row.claimConflictReason !== "name_collision"
  ) {
    return { ok: false, reason: "not_name_review" };
  }
  if (!row.linkedAshedMemberId || !row.hqUserId) {
    return { ok: false, reason: "missing_target" };
  }

  const rosterName = row.reportedName?.trim();
  const lookupName = row.gameUserName?.trim();
  if (!rosterName || !lookupName) {
    return { ok: false, reason: "missing_names" };
  }

  const chosenName = input.chosen === "lookup" ? lookupName : rosterName;
  const targetAshedMemberId = row.linkedAshedMemberId;

  if (input.chosen === "lookup") {
    await reconcileAllianceMemberForRosterLink({
      allianceId: row.allianceId,
      ashedMemberId: targetAshedMemberId,
      gameUserName: chosenName,
      ashedConnection: null,
    });
  }

  const existingLink = await getHqMemberLinkByAllianceAndMember(
    row.allianceId,
    targetAshedMemberId,
  );
  if (existingLink && existingLink.hqUserId === row.hqUserId) {
    await linkHqMember({
      allianceId: row.allianceId,
      hqUserId: row.hqUserId,
      ashedMemberId: targetAshedMemberId,
      memberDisplayName: chosenName,
      gameUid: existingLink.gameUid,
    });
  }

  const resolved = await resolveMemberLinkHelpRequest({
    requestId: input.requestId,
    allianceId: input.allianceId,
    resolvedByHqUserId: input.resolvedByHqUserId,
    sessionId: input.sessionId,
    action: "resolve",
    resolutionNote: `name:${input.chosen}`,
  });
  if (!resolved.ok) return resolved;

  return { ok: true, memberName: chosenName };
}
