import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { MEMBER_LINK_HELP_INBOX_KIND } from "@/lib/member-link/member-link-help-inbox.shared";

export type MemberLinkHelpContext =
  | "onboarding_form"
  | "walkthrough"
  | "roster_miss"
  | "discord_button"
  | "claim_conflict"
  | "cross_layer_claim";

export type MemberLinkClaimConflictReason =
  | "name_collision"
  | "commander_taken"
  | "server_mismatch"
  | "target_mismatch"
  | "discord_hq_unlinked";

export type MemberLinkHelpOrigin = "web" | "discord";

export type MemberLinkHelpStatus = "open" | "resolved" | "dismissed";

export type MemberLinkHelpRequestView = {
  id: string;
  allianceId: string;
  allianceTag: string | null;
  allianceName: string | null;
  origin: MemberLinkHelpOrigin;
  context: MemberLinkHelpContext;
  requesterHandle: string;
  reportedName: string | null;
  gameUserName: string | null;
  gameUidLast4: string | null;
  discordUsername: string | null;
  hqUserId: string | null;
  status: MemberLinkHelpStatus;
  claimConflictReason: MemberLinkClaimConflictReason | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapPendingToHelpContext(
  pending: { kind: string } | null | undefined,
  fallback: MemberLinkHelpContext,
): MemberLinkHelpContext {
  if (pending?.kind === "link_roster_miss") return "roster_miss";
  if (pending?.kind === "link_walkthrough") return "walkthrough";
  return fallback;
}

export function resolveWebHelpContext(
  pending: { kind: string } | null | undefined,
): MemberLinkHelpContext {
  return mapPendingToHelpContext(pending, "onboarding_form");
}

export function resolveDiscordHelpContext(
  pending: { kind: string } | null | undefined,
): MemberLinkHelpContext {
  return mapPendingToHelpContext(pending, "discord_button");
}

async function materializeHelpInboxItem(input: {
  allianceId: string;
  requestId: string;
  title: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, MEMBER_LINK_HELP_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, input.requestId),
      ),
    );

  await db.insert(schema.inboxReminderItems).values({
    id: nanoid(16),
    allianceId: input.allianceId,
    kind: MEMBER_LINK_HELP_INBOX_KIND,
    title: input.title,
    body: null,
    scoreTarget: input.title,
    href: `/members/member-link-help/${input.requestId}`,
    requiredPermission: "members:write",
    active: 1,
    resourceId: input.requestId,
  });
}

export async function satisfyHelpInboxItem(requestId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.kind, MEMBER_LINK_HELP_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, requestId),
      ),
    );
}

function inboxTitle(input: {
  gameUserName: string | null;
  requesterHandle: string;
}): string {
  return input.gameUserName?.trim() || input.requesterHandle.trim() || "Member";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function openHelpRequestSubjectFilter(input: {
  hqUserId?: string | null;
  discordUserId?: string | null;
  requesterHandle: string;
}) {
  return input.hqUserId
    ? eq(schema.hqMemberLinkHelpRequests.hqUserId, input.hqUserId)
    : input.discordUserId
      ? eq(schema.hqMemberLinkHelpRequests.discordUserId, input.discordUserId)
      : eq(schema.hqMemberLinkHelpRequests.requesterHandle, input.requesterHandle);
}

function openClaimConflictSubjectFilter(input: {
  hqUserId?: string | null;
  requesterHandle: string;
}) {
  return input.hqUserId
    ? eq(schema.hqMemberLinkHelpRequests.hqUserId, input.hqUserId)
    : eq(schema.hqMemberLinkHelpRequests.requesterHandle, input.requesterHandle);
}

async function findOpenClaimConflictHelpRequest(input: {
  allianceId: string;
  context: "claim_conflict" | "cross_layer_claim";
  targetAshedMemberId: string;
  claimConflictReason: MemberLinkClaimConflictReason;
  hqUserId?: string | null;
  requesterHandle: string;
}): Promise<{ id: string } | null> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.hqMemberLinkHelpRequests.id })
    .from(schema.hqMemberLinkHelpRequests)
    .where(
      and(
        eq(schema.hqMemberLinkHelpRequests.allianceId, input.allianceId),
        eq(schema.hqMemberLinkHelpRequests.status, "open"),
        eq(schema.hqMemberLinkHelpRequests.context, input.context),
        eq(
          schema.hqMemberLinkHelpRequests.linkedAshedMemberId,
          input.targetAshedMemberId,
        ),
        eq(
          schema.hqMemberLinkHelpRequests.claimConflictReason,
          input.claimConflictReason,
        ),
        openClaimConflictSubjectFilter(input),
      ),
    )
    .limit(1);
  return existing ?? null;
}

async function updateHelpRequestSnapshot(input: {
  id: string;
  origin: MemberLinkHelpOrigin;
  context: MemberLinkHelpContext;
  requesterHandle: string;
  reportedName: string | null;
  gameUid: string | null;
  gameUserName: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  linkedAshedMemberId: string | null;
  claimConflictReason: MemberLinkClaimConflictReason | null;
  updatedAt: Date;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hqMemberLinkHelpRequests)
    .set({
      origin: input.origin,
      context: input.context,
      requesterHandle: input.requesterHandle,
      reportedName: input.reportedName,
      gameUid: input.gameUid,
      gameUserName: input.gameUserName,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      linkedAshedMemberId: input.linkedAshedMemberId,
      claimConflictReason: input.claimConflictReason,
      updatedAt: input.updatedAt,
    })
    .where(eq(schema.hqMemberLinkHelpRequests.id, input.id));
}

/**
 * Persist an Ask-an-officer help request for alliance officers and platform
 * maintainers. De-duplicates open rows per alliance + requester identity.
 * Claim-conflict rows additionally de-dupe on target commander + reason so
 * retries do not stack duplicate review items.
 */
export async function recordMemberLinkHelpRequest(input: {
  allianceId: string;
  hqUserId?: string | null;
  origin: MemberLinkHelpOrigin;
  context: MemberLinkHelpContext;
  requesterHandle: string;
  reportedName?: string | null;
  gameUid?: string | null;
  gameUserName?: string | null;
  discordUserId?: string | null;
  discordUsername?: string | null;
  targetAshedMemberId?: string | null;
  claimConflictReason?: MemberLinkClaimConflictReason | null;
}): Promise<string> {
  const db = getDb();
  const now = new Date();
  const gameUid = input.gameUid?.trim() || null;
  const targetAshedMemberId = input.targetAshedMemberId?.trim() || null;
  const claimConflictReason = input.claimConflictReason ?? null;
  const useClaimConflictDedup =
    (input.context === "claim_conflict" ||
      input.context === "cross_layer_claim") &&
    targetAshedMemberId !== null &&
    claimConflictReason !== null;

  const title = inboxTitle({
    gameUserName: input.gameUserName ?? null,
    requesterHandle: input.requesterHandle,
  });

  const snapshot = {
    origin: input.origin,
    context: input.context,
    requesterHandle: input.requesterHandle.trim(),
    reportedName: input.reportedName?.trim() || null,
    gameUid,
    gameUserName: input.gameUserName?.trim() || null,
    discordUserId: input.discordUserId ?? null,
    discordUsername: input.discordUsername ?? null,
    linkedAshedMemberId: useClaimConflictDedup ? targetAshedMemberId : null,
    claimConflictReason: useClaimConflictDedup ? claimConflictReason : null,
    updatedAt: now,
  };

  const existing = useClaimConflictDedup
    ? await findOpenClaimConflictHelpRequest({
        allianceId: input.allianceId,
        context: input.context as "claim_conflict" | "cross_layer_claim",
        targetAshedMemberId,
        claimConflictReason,
        hqUserId: input.hqUserId ?? null,
        requesterHandle: input.requesterHandle.trim(),
      })
    : await (async () => {
        const [row] = await db
          .select({ id: schema.hqMemberLinkHelpRequests.id })
          .from(schema.hqMemberLinkHelpRequests)
          .where(
            and(
              eq(schema.hqMemberLinkHelpRequests.allianceId, input.allianceId),
              eq(schema.hqMemberLinkHelpRequests.status, "open"),
              openHelpRequestSubjectFilter(input),
            ),
          )
          .limit(1);
        return row ?? null;
      })();

  if (existing) {
    await updateHelpRequestSnapshot({ id: existing.id, ...snapshot });
    await materializeHelpInboxItem({
      allianceId: input.allianceId,
      requestId: existing.id,
      title,
    });
    return existing.id;
  }

  const id = nanoid();
  try {
    await db.insert(schema.hqMemberLinkHelpRequests).values({
      id,
      allianceId: input.allianceId,
      hqUserId: input.hqUserId ?? null,
      status: "open",
      createdAt: now,
      ...snapshot,
    });
  } catch (error) {
    if (!useClaimConflictDedup || !isUniqueViolation(error)) {
      throw error;
    }
    const racedExisting = await findOpenClaimConflictHelpRequest({
      allianceId: input.allianceId,
      context: input.context as "claim_conflict" | "cross_layer_claim",
      targetAshedMemberId,
      claimConflictReason,
      hqUserId: input.hqUserId ?? null,
      requesterHandle: input.requesterHandle.trim(),
    });
    if (!racedExisting) throw error;
    await updateHelpRequestSnapshot({ id: racedExisting.id, ...snapshot });
    await materializeHelpInboxItem({
      allianceId: input.allianceId,
      requestId: racedExisting.id,
      title,
    });
    return racedExisting.id;
  }

  await materializeHelpInboxItem({
    allianceId: input.allianceId,
    requestId: id,
    title,
  });

  return id;
}

function mapHelpRow(
  row: typeof schema.hqMemberLinkHelpRequests.$inferSelect & {
    allianceTag: string | null;
    allianceName: string | null;
  },
): MemberLinkHelpRequestView {
  return {
    id: row.id,
    allianceId: row.allianceId,
    allianceTag: row.allianceTag,
    allianceName: row.allianceName,
    origin: row.origin as MemberLinkHelpOrigin,
    context: row.context as MemberLinkHelpContext,
    requesterHandle: row.requesterHandle,
    reportedName: row.reportedName,
    gameUserName: row.gameUserName,
    gameUidLast4: row.gameUid ? row.gameUid.slice(-4) : null,
    discordUsername: row.discordUsername,
    hqUserId: row.hqUserId,
    status: row.status as MemberLinkHelpStatus,
    claimConflictReason:
      (row.claimConflictReason as MemberLinkClaimConflictReason | null) ??
      null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listMemberLinkHelpRequestsForAlliance(
  allianceId: string,
  status: MemberLinkHelpStatus = "open",
): Promise<MemberLinkHelpRequestView[]> {
  const db = getDb();
  const rows = await db
    .select({
      request: schema.hqMemberLinkHelpRequests,
      allianceTag: schema.alliances.tag,
      allianceName: schema.alliances.name,
    })
    .from(schema.hqMemberLinkHelpRequests)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinkHelpRequests.allianceId),
    )
    .where(
      and(
        eq(schema.hqMemberLinkHelpRequests.allianceId, allianceId),
        eq(schema.hqMemberLinkHelpRequests.status, status),
      ),
    )
    .orderBy(desc(schema.hqMemberLinkHelpRequests.createdAt));

  return rows.map((row) =>
    mapHelpRow({
      ...row.request,
      allianceTag: row.allianceTag,
      allianceName: row.allianceName,
    }),
  );
}

export async function listMemberLinkHelpRequestsForAdmin(
  status: MemberLinkHelpStatus = "open",
  limit = 100,
): Promise<MemberLinkHelpRequestView[]> {
  const db = getDb();
  const rows = await db
    .select({
      request: schema.hqMemberLinkHelpRequests,
      allianceTag: schema.alliances.tag,
      allianceName: schema.alliances.name,
    })
    .from(schema.hqMemberLinkHelpRequests)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqMemberLinkHelpRequests.allianceId),
    )
    .where(eq(schema.hqMemberLinkHelpRequests.status, status))
    .orderBy(desc(schema.hqMemberLinkHelpRequests.createdAt))
    .limit(limit);

  return rows.map((row) =>
    mapHelpRow({
      ...row.request,
      allianceTag: row.allianceTag,
      allianceName: row.allianceName,
    }),
  );
}

export async function countOpenMemberLinkHelpRequests(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqMemberLinkHelpRequests)
    .where(eq(schema.hqMemberLinkHelpRequests.status, "open"));
  return row?.count ?? 0;
}

export async function getMemberLinkHelpRequestById(
  id: string,
): Promise<(typeof schema.hqMemberLinkHelpRequests.$inferSelect) | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinkHelpRequests)
    .where(eq(schema.hqMemberLinkHelpRequests.id, id))
    .limit(1);
  return row ?? null;
}

export async function resolveMemberLinkHelpRequest(input: {
  requestId: string;
  allianceId?: string;
  resolvedByHqUserId: string;
  sessionId: string;
  action: "resolve" | "dismiss";
  resolutionNote?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const row = await getMemberLinkHelpRequestById(input.requestId);
  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (input.allianceId && row.allianceId !== input.allianceId) {
    return { ok: false, reason: "not_found" };
  }
  if (row.status !== "open") {
    return { ok: false, reason: "already_closed" };
  }

  const now = new Date();
  const status: MemberLinkHelpStatus =
    input.action === "resolve" ? "resolved" : "dismissed";

  await db
    .update(schema.hqMemberLinkHelpRequests)
    .set({
      status,
      resolutionNote: input.resolutionNote?.trim() || null,
      resolvedAt: now,
      resolvedByHqUserId: input.resolvedByHqUserId,
      updatedAt: now,
    })
    .where(eq(schema.hqMemberLinkHelpRequests.id, input.requestId));

  await satisfyHelpInboxItem(input.requestId);

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: row.allianceId,
    action: "member_link_help_resolved",
    resourceType: "hq_member_link_help_request",
    resourceId: input.requestId,
    metadata: {
      status,
      origin: row.origin,
      context: row.context,
    },
  });

  return { ok: true };
}
