import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { resolveAppOrigin } from "@/lib/app-origin";
import { emitMemberLinkUidTakenAlert } from "@/lib/events/admin-alerts";
import { getDb, schema } from "@/lib/db";
import { resolveAllianceGameServerNumber, linkAllianceToGameServer } from "@/lib/game-season/game-servers.server";
import { applySeasonSync } from "@/lib/game-season/sync";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import { parseGameServerNumberFromUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import type {
  MemberLinkApiResponse,
  MemberLinkServerConfirmReason,
} from "@/lib/member-link/outcome.shared";
import {
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import {
  materializeRosterLinkInboxItem,
  satisfyRosterLinkInboxItem,
} from "@/lib/member-link/roster-link-inbox.server";
import {
  sendRosterLinkInviteeResolvedEmail,
  sendRosterLinkOwnerApprovalEmail,
} from "@/lib/member-link/roster-link-owner-email.server";
import { createMemberLinkTranslator } from "@/lib/member-link/translate.server";
import {
  bindDiscordRosterLinkRequest,
  reconcileAllianceMemberForRosterLink,
} from "@/lib/member-link/roster-link-resolve.server";
import type { ParsedConnection } from "@/lib/connectionString";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";
import { namesMatch } from "@/lib/vr/link-helpers";

const INVITE_MEMBER_LINK_KINDS = ["email", "protected_link"] as const;
const ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RosterLinkRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded";

function hashActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateActionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashActionToken(token) };
}

export async function findAcceptedInviteForMemberLink(
  allianceId: string,
  hqUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.allianceId, allianceId),
        eq(schema.hqInvites.acceptedByHqUserId, hqUserId),
        inArray(schema.hqInvites.kind, [...INVITE_MEMBER_LINK_KINDS]),
      ),
    )
    .orderBy(desc(schema.hqInvites.acceptedAt))
    .limit(1);

  if (!row?.acceptedAt) return null;
  return row;
}

export async function getRosterLinkRequestById(requestId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqRosterLinkRequests)
    .where(eq(schema.hqRosterLinkRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

async function supersedePendingRequests(
  allianceId: string,
  hqUserId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const pending = await db
    .select({ id: schema.hqRosterLinkRequests.id })
    .from(schema.hqRosterLinkRequests)
    .where(
      and(
        eq(schema.hqRosterLinkRequests.allianceId, allianceId),
        eq(schema.hqRosterLinkRequests.hqUserId, hqUserId),
        eq(schema.hqRosterLinkRequests.status, "pending"),
      ),
    );

  if (pending.length === 0) return;

  await db
    .update(schema.hqRosterLinkRequests)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(schema.hqRosterLinkRequests.allianceId, allianceId),
        eq(schema.hqRosterLinkRequests.hqUserId, hqUserId),
        eq(schema.hqRosterLinkRequests.status, "pending"),
      ),
    );

  for (const row of pending) {
    await satisfyRosterLinkInboxItem(row.id);
  }
}

async function insertActionTokens(
  requestId: string,
): Promise<{ acceptToken: string; rejectToken: string }> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + ACTION_TOKEN_TTL_MS);
  const accept = generateActionToken();
  const reject = generateActionToken();

  await db.insert(schema.hqRosterLinkActionTokens).values([
    {
      id: nanoid(),
      requestId,
      action: "accept",
      tokenHash: accept.tokenHash,
      expiresAt,
    },
    {
      id: nanoid(),
      requestId,
      action: "reject",
      tokenHash: reject.tokenHash,
      expiresAt,
    },
  ]);

  return { acceptToken: accept.token, rejectToken: reject.token };
}

export async function createRosterLinkRequest(input: {
  allianceId: string;
  allianceTag: string;
  hqUserId: string;
  inviteId?: string | null;
  reportedName: string;
  gameUid: string;
  gameUserName: string;
  gameServerNumber?: number | null;
  gameUserLevel?: number;
  origin?: "web" | "discord";
  discordUserId?: string | null;
  discordUsername?: string | null;
  /** Officer-confirmable hint only; never an accepted resolution. */
  suggestedTargetAshedMemberId?: string | null;
  suggestionMethod?: string | null;
  notifyOwner?: boolean;
}): Promise<{
  requestId: string;
  acceptToken: string;
  rejectToken: string;
}> {
  const db = getDb();
  const now = new Date();
  await supersedePendingRequests(input.allianceId, input.hqUserId);

  const requestId = nanoid();
  await db.insert(schema.hqRosterLinkRequests).values({
    id: requestId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    inviteId: input.inviteId ?? null,
    origin: input.origin ?? "web",
    discordUserId: input.discordUserId ?? null,
    discordUsername: input.discordUsername ?? null,
    reportedName: input.reportedName,
    gameUid: input.gameUid,
    gameUserName: input.gameUserName,
    gameServerNumber: input.gameServerNumber ?? null,
    gameUserLevel: input.gameUserLevel ?? null,
    suggestedTargetAshedMemberId: input.suggestedTargetAshedMemberId ?? null,
    suggestionMethod: input.suggestionMethod ?? null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  const tokens = await insertActionTokens(requestId);

  if ((input.origin ?? "web") === "web") {
    await saveHqMemberLinkPending(input.allianceId, input.hqUserId, {
      kind: "link_awaiting_owner",
      requestId,
      gameUserName: input.gameUserName,
    });
  }

  await materializeRosterLinkInboxItem({
    allianceId: input.allianceId,
    requestId,
    gameUserName: input.gameUserName,
  });

  try {
    if (input.notifyOwner !== false) {
      await sendRosterLinkOwnerApprovalEmail({
        allianceId: input.allianceId,
        allianceTag: input.allianceTag,
        requestId,
        gameUserName: input.gameUserName,
        reportedName: input.reportedName,
        gameUid: input.gameUid,
        gameServerNumber: input.gameServerNumber ?? null,
        acceptToken: tokens.acceptToken,
        rejectToken: tokens.rejectToken,
      });
    }
  } catch (error) {
    console.error("[roster-link] owner email failed", error);
  }

  return { requestId, ...tokens };
}

type MemberLinkServerGate =
  | { ok: true; playerServer: number }
  | { ok: false; response: MemberLinkApiResponse };

async function resolveMemberLinkServerGate(input: {
  allianceId: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  translate: ReturnType<typeof createMemberLinkTranslator>;
}): Promise<MemberLinkServerGate> {
  const playerServer = input.lookup.gameServerNumber;
  if (playerServer == null) {
    return {
      ok: false,
      response: {
        outcome: "wrong_server",
        message: input.translate("wrongServer"),
        pending: null,
      },
    };
  }

  const allianceServer = await resolveAllianceGameServerNumber(input.allianceId);
  if (allianceServer == null || playerServer !== allianceServer) {
    return {
      ok: false,
      response: {
        outcome: "wrong_server",
        message: input.translate("wrongServer"),
        pending: null,
      },
    };
  }

  return { ok: true, playerServer };
}

async function resolveColdStartOwnerGate(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<{ allowed: true; inviteId?: string } | { allowed: false }> {
  const db = getDb();
  const [alliance] = await db
    .select({ ownerHqUserId: schema.alliances.ownerHqUserId })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (alliance?.ownerHqUserId === input.hqUserId) {
    return { allowed: true };
  }

  const invite = await findAcceptedInviteForMemberLink(
    input.allianceId,
    input.hqUserId,
  );
  if (invite && systemRoleNameForId(invite.roleId) === "owner") {
    return { allowed: true, inviteId: invite.id };
  }

  return { allowed: false };
}

export async function isOwnerColdStartEligible(input: {
  allianceId: string;
  hqUserId: string;
  rosterCount: number;
}): Promise<boolean> {
  if (!(await isNativeAlliance(input.allianceId))) {
    return false;
  }
  if (input.rosterCount > 0) {
    return false;
  }
  const ownerGate = await resolveColdStartOwnerGate({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
  });
  return ownerGate.allowed;
}

type OwnerColdStartServerResolution =
  | { ok: true; serverNumber: number; adoptedAllianceServer: boolean }
  | { ok: false; response: MemberLinkApiResponse };

async function resolveOwnerColdStartServer(input: {
  allianceId: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  ownerProvidedServerNumber?: number;
  translate: ReturnType<typeof createMemberLinkTranslator>;
}): Promise<OwnerColdStartServerResolution> {
  const allianceServer = await resolveAllianceGameServerNumber(input.allianceId);
  const lookupServer =
    input.lookup.gameServerNumber ??
    parseGameServerNumberFromUid(input.gameUid) ??
    null;

  if (input.ownerProvidedServerNumber != null) {
    const server = input.ownerProvidedServerNumber;
    if (allianceServer === null || allianceServer !== server) {
      await linkAllianceToGameServer(input.allianceId, server);
      await applySeasonSync(input.allianceId);
      return {
        ok: true,
        serverNumber: server,
        adoptedAllianceServer: allianceServer === null,
      };
    }
    return {
      ok: true,
      serverNumber: server,
      adoptedAllianceServer: false,
    };
  }

  if (lookupServer == null) {
    return {
      ok: false,
      response: buildConfirmServerResponse({
        translate: input.translate,
        reason: "missing",
        lookupServerNumber: null,
        allianceServerNumber: allianceServer,
      }),
    };
  }

  if (allianceServer === null) {
    await linkAllianceToGameServer(input.allianceId, lookupServer);
    await applySeasonSync(input.allianceId);
    return {
      ok: true,
      serverNumber: lookupServer,
      adoptedAllianceServer: true,
    };
  }

  if (allianceServer !== lookupServer) {
    return {
      ok: false,
      response: buildConfirmServerResponse({
        translate: input.translate,
        reason: "mismatch",
        lookupServerNumber: lookupServer,
        allianceServerNumber: allianceServer,
      }),
    };
  }

  return {
    ok: true,
    serverNumber: lookupServer,
    adoptedAllianceServer: false,
  };
}

function buildConfirmServerResponse(input: {
  translate: ReturnType<typeof createMemberLinkTranslator>;
  reason: MemberLinkServerConfirmReason;
  lookupServerNumber: number | null;
  allianceServerNumber: number | null;
}): MemberLinkApiResponse {
  const message =
    input.reason === "missing"
      ? input.translate("confirmServerMissing")
      : input.translate("confirmServerMismatch", {
          lookupServer: input.lookupServerNumber ?? "—",
          allianceServer: input.allianceServerNumber ?? "—",
        });

  return {
    outcome: "confirm_server",
    message,
    pending: null,
    serverConfirmReason: input.reason,
    lookupServerNumber: input.lookupServerNumber,
    allianceServerNumber: input.allianceServerNumber,
  };
}

async function notifyMemberLinkUidTaken(input: {
  allianceId: string;
  ashedMemberId: string;
  hqUserId: string;
  handle: string;
}): Promise<void> {
  const allianceTag = await loadAllianceTag(input.allianceId);
  try {
    await emitMemberLinkUidTakenAlert({
      allianceId: input.allianceId,
      allianceTag,
      ashedMemberId: input.ashedMemberId,
      hqUserId: input.hqUserId,
      handle: input.handle,
    });
  } catch (error) {
    console.error("[member-link] uid-taken admin alert failed", error);
  }
}

export async function tryBootstrapOwnerColdStartMember(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  reportedName: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  rosterCount: number;
  sessionId?: string;
  auditBag?: { ashedMemberId?: string };
  ownerProvidedServerNumber?: number;
  handle?: string;
}): Promise<MemberLinkApiResponse | null> {
  if (!(await isNativeAlliance(input.allianceId))) {
    return null;
  }

  if (input.rosterCount > 0) {
    return null;
  }

  const translate = createMemberLinkTranslator(input.locale);

  const ownerGate = await resolveColdStartOwnerGate({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
  });
  if (!ownerGate.allowed) {
    return null;
  }

  if (!namesMatch(input.reportedName, input.lookup.gameUserName)) {
    return null;
  }

  const serverResolution = await resolveOwnerColdStartServer({
    allianceId: input.allianceId,
    gameUid: input.gameUid,
    lookup: input.lookup,
    ownerProvidedServerNumber: input.ownerProvidedServerNumber,
    translate,
  });
  if (!serverResolution.ok) {
    return serverResolution.response;
  }

  const playerServer = serverResolution.serverNumber;
  const adoptedAllianceServer = serverResolution.adoptedAllianceServer;

  const ashedMemberId = await createNativeAllianceMemberForRosterLink({
    allianceId: input.allianceId,
    gameUserName: input.lookup.gameUserName,
    gameUserLevel: input.lookup.gameUserLevel,
  });

  const linked = await linkHqMember({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId,
    memberDisplayName: input.lookup.gameUserName,
    gameUid: input.gameUid,
  });

  if (!linked.ok) {
    if (input.handle) {
      await notifyMemberLinkUidTaken({
        allianceId: input.allianceId,
        ashedMemberId,
        hqUserId: input.hqUserId,
        handle: input.handle,
      });
    }
    return {
      outcome: "member_taken",
      message: translate("link.memberTaken"),
      pending: null,
    };
  }

  // Persist the owner's member identity so Discord /link-alliance owner proof
  // (callerOwnsAllianceViaMemberLink) can verify without Ashed credentials.
  try {
    await maybeSetOwnerMemberExternalId({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      ashedMemberId,
    });
  } catch (error) {
    console.error("[member-link] owner externalId sync failed", error);
  }

  await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
  await syncPrimaryGameUidFromHqMemberLink(input.hqUserId, input.gameUid);

  if (input.lookup.gameUserLevel != null) {
    try {
      await syncAllianceMemberGameLevelFromLastWar({
        allianceId: input.allianceId,
        ashedMemberId,
        gameUserLevel: input.lookup.gameUserLevel,
      });
    } catch (error) {
      console.error("[member-link] owner cold-start level sync failed", error);
    }
  }

  if (input.auditBag) {
    input.auditBag.ashedMemberId = ashedMemberId;
  }

  if (input.sessionId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      allianceId: input.allianceId,
      action: "member_link.owner_cold_start_bootstrap",
      metadata: {
        ashedMemberId,
        inviteId: ownerGate.inviteId ?? null,
        gameServerNumber: playerServer,
        adoptedAllianceServer,
      },
    });
  }

  return {
    outcome: "linked",
    message: translate("link.linked", { name: input.lookup.gameUserName }),
    pending: null,
    linkedMemberName: input.lookup.gameUserName,
  };
}

export async function tryRouteRosterMissToOwnerApproval(input: {
  allianceId: string;
  allianceTag: string;
  hqUserId: string;
  locale: string;
  reportedName: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  suggestedTargetAshedMemberId?: string | null;
  suggestionMethod?: string | null;
}): Promise<MemberLinkApiResponse | null> {
  const translate = createMemberLinkTranslator(input.locale);
  const serverGate = await resolveMemberLinkServerGate({
    allianceId: input.allianceId,
    lookup: input.lookup,
    translate,
  });
  if (!serverGate.ok) {
    return serverGate.response;
  }

  const invite = await findAcceptedInviteForMemberLink(
    input.allianceId,
    input.hqUserId,
  );

  const { requestId } = await createRosterLinkRequest({
    allianceId: input.allianceId,
    allianceTag: input.allianceTag,
    hqUserId: input.hqUserId,
    inviteId: invite?.id ?? null,
    reportedName: input.reportedName,
    gameUid: input.gameUid,
    gameUserName: input.lookup.gameUserName,
    gameServerNumber: serverGate.playerServer,
    gameUserLevel: input.lookup.gameUserLevel,
    suggestedTargetAshedMemberId: input.suggestedTargetAshedMemberId ?? null,
    suggestionMethod: input.suggestionMethod ?? null,
  });

  return {
    outcome: "awaiting_owner",
    message: translate("awaitingOwner"),
    pending: {
      kind: "link_awaiting_owner",
      requestId,
      gameUserName: input.lookup.gameUserName,
    },
  };
}

export async function createDiscordRosterMissLinkRequest(input: {
  allianceId: string;
  allianceTag: string;
  discordUserId: string;
  discordUsername?: string | null;
  hqUserId: string;
  reportedName: string;
  gameUid: string;
  gameUserName: string;
  gameServerNumber?: number | null;
  gameUserLevel?: number;
  suggestedTargetAshedMemberId?: string | null;
  suggestionMethod?: string | null;
}): Promise<string | null> {
  try {
    const { requestId } = await createRosterLinkRequest({
      allianceId: input.allianceId,
      allianceTag: input.allianceTag,
      hqUserId: input.hqUserId,
      inviteId: null,
      reportedName: input.reportedName,
      gameUid: input.gameUid,
      gameUserName: input.gameUserName,
      gameServerNumber: input.gameServerNumber ?? null,
      gameUserLevel: input.gameUserLevel,
      origin: "discord",
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername ?? null,
      suggestedTargetAshedMemberId: input.suggestedTargetAshedMemberId ?? null,
      suggestionMethod: input.suggestionMethod ?? null,
    });
    return requestId;
  } catch (error) {
    console.error("[roster-link] discord roster miss request failed", error);
    return null;
  }
}

async function createNativeAllianceMemberForRosterLink(input: {
  allianceId: string;
  gameUserName: string;
  gameUserLevel?: number | null;
}): Promise<string> {
  const db = getDb();
  const now = new Date();
  const ashedMemberId = nanoid(16);
  const ashedAllianceId = nativeRosterAshedAllianceId(input.allianceId);

  await db.insert(schema.allianceMembers).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId,
    ashedAllianceId,
    currentName: input.gameUserName,
    previousNamesJson: [],
    status: "active",
    memberLevel: input.gameUserLevel ?? null,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return ashedMemberId;
}

async function loadHqUserEmail(hqUserId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return row?.email?.trim() || null;
}

async function loadAllianceTag(allianceId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.tag ?? "alliance";
}

async function notifyInviteeOnResolve(
  request: typeof schema.hqRosterLinkRequests.$inferSelect,
  accepted: boolean,
): Promise<void> {
  const email = await loadHqUserEmail(request.hqUserId);
  if (!email) return;
  const allianceTag = await loadAllianceTag(request.allianceId);
  try {
    await sendRosterLinkInviteeResolvedEmail({
      to: email,
      allianceTag,
      accepted,
    });
  } catch (error) {
    console.error("[roster-link] invitee email failed", error);
  }
}

export async function acceptRosterLinkRequest(input: {
  requestId: string;
  resolvedByHqUserId?: string | null;
  sessionId?: string | null;
  targetAshedMemberId?: string | null;
  ashedConnection?: ParsedConnection | null;
}): Promise<{ ok: true; memberName: string } | { ok: false; reason: string }> {
  const db = getDb();
  const request = await getRosterLinkRequestById(input.requestId);
  if (!request) {
    return { ok: false, reason: "not_found" };
  }

  if (request.status === "accepted") {
    return { ok: true, memberName: request.gameUserName };
  }

  if (request.status !== "pending") {
    return { ok: false, reason: "not_pending" };
  }

  const now = new Date();
  let ashedMemberId =
    input.targetAshedMemberId ??
    request.targetAshedMemberId ??
    request.createdMemberId;

  if (input.targetAshedMemberId) {
    await reconcileAllianceMemberForRosterLink({
      allianceId: request.allianceId,
      ashedMemberId: input.targetAshedMemberId,
      gameUserName: request.gameUserName,
      ashedConnection: input.ashedConnection,
    });
    ashedMemberId = input.targetAshedMemberId;
  } else if (!ashedMemberId) {
    ashedMemberId = await createNativeAllianceMemberForRosterLink({
      allianceId: request.allianceId,
      gameUserName: request.gameUserName,
      gameUserLevel: request.gameUserLevel,
    });
  }

  if (request.origin === "discord" && request.discordUserId) {
    const linked = await bindDiscordRosterLinkRequest({
      allianceId: request.allianceId,
      discordUserId: request.discordUserId,
      discordUsername: request.discordUsername,
      ashedMemberId,
      memberDisplayName: request.gameUserName,
      gameUid: request.gameUid,
    });
    if (!linked.ok) {
      return { ok: false, reason: linked.reason };
    }
  } else {
    const linked = await linkHqMember({
      allianceId: request.allianceId,
      hqUserId: request.hqUserId,
      ashedMemberId,
      memberDisplayName: request.gameUserName,
      gameUid: request.gameUid,
    });

    if (!linked.ok) {
      return { ok: false, reason: linked.reason };
    }

    await syncPrimaryGameUidFromHqMemberLink(request.hqUserId, request.gameUid);
  }

  if (request.gameUserLevel != null) {
    try {
      await syncAllianceMemberGameLevelFromLastWar({
        allianceId: request.allianceId,
        ashedMemberId,
        gameUserLevel: request.gameUserLevel,
      });
    } catch (error) {
      console.error("[roster-link] level sync failed", error);
    }
  }

  await db
    .update(schema.hqRosterLinkRequests)
    .set({
      status: "accepted",
      resolvedAt: now,
      resolvedByHqUserId: input.resolvedByHqUserId ?? null,
      createdMemberId: ashedMemberId,
      targetAshedMemberId: input.targetAshedMemberId ?? request.targetAshedMemberId,
      updatedAt: now,
    })
    .where(eq(schema.hqRosterLinkRequests.id, request.id));

  await db
    .update(schema.hqRosterLinkActionTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.hqRosterLinkActionTokens.requestId, request.id),
        isNull(schema.hqRosterLinkActionTokens.usedAt),
      ),
    );

  await saveHqMemberLinkPending(request.allianceId, request.hqUserId, null);
  await satisfyRosterLinkInboxItem(request.id);
  await notifyInviteeOnResolve(request, true);

  if (input.sessionId && input.resolvedByHqUserId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.resolvedByHqUserId,
      allianceId: request.allianceId,
      action: "member_link.roster_request_accepted",
      metadata: {
        requestId: request.id,
        hqUserId: request.hqUserId,
        ashedMemberId,
      },
    });
  }

  return { ok: true, memberName: request.gameUserName };
}

export async function rejectRosterLinkRequest(input: {
  requestId: string;
  resolvedByHqUserId?: string | null;
  sessionId?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const request = await getRosterLinkRequestById(input.requestId);
  if (!request) {
    return { ok: false, reason: "not_found" };
  }

  if (request.status === "rejected") {
    return { ok: true };
  }

  if (request.status !== "pending") {
    return { ok: false, reason: "not_pending" };
  }

  const now = new Date();
  await db
    .update(schema.hqRosterLinkRequests)
    .set({
      status: "rejected",
      resolvedAt: now,
      resolvedByHqUserId: input.resolvedByHqUserId ?? null,
      updatedAt: now,
    })
    .where(eq(schema.hqRosterLinkRequests.id, request.id));

  await db
    .update(schema.hqRosterLinkActionTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.hqRosterLinkActionTokens.requestId, request.id),
        isNull(schema.hqRosterLinkActionTokens.usedAt),
      ),
    );

  await saveHqMemberLinkPending(request.allianceId, request.hqUserId, null);
  await satisfyRosterLinkInboxItem(request.id);
  await notifyInviteeOnResolve(request, false);

  if (input.sessionId && input.resolvedByHqUserId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      hqUserId: input.resolvedByHqUserId,
      allianceId: request.allianceId,
      action: "member_link.roster_request_rejected",
      metadata: { requestId: request.id, hqUserId: request.hqUserId },
    });
  }

  return { ok: true };
}

export type RosterLinkActionResult = {
  ok: boolean;
  action?: "accept" | "reject";
  title: string;
  body: string;
  alreadyResolved?: boolean;
  redirectUrl?: string;
};

async function claimRosterLinkActionToken(
  tokenHash: string,
  now = new Date(),
) {
  const db = getDb();
  const [claimed] = await db
    .update(schema.hqRosterLinkActionTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.hqRosterLinkActionTokens.tokenHash, tokenHash),
        isNull(schema.hqRosterLinkActionTokens.usedAt),
        gt(schema.hqRosterLinkActionTokens.expiresAt, now),
      ),
    )
    .returning();
  return claimed ?? null;
}

async function describeUsedRosterLinkActionToken(
  tokenRow: typeof schema.hqRosterLinkActionTokens.$inferSelect,
): Promise<RosterLinkActionResult> {
  const request = await getRosterLinkRequestById(tokenRow.requestId);
  if (request?.status === "accepted" && tokenRow.action === "accept") {
    return {
      ok: true,
      action: "accept",
      title: "Already approved",
      body: `${request.gameUserName} was already approved to join the roster.`,
      alreadyResolved: true,
    };
  }
  if (request?.status === "rejected" && tokenRow.action === "reject") {
    return {
      ok: true,
      action: "reject",
      title: "Already declined",
      body: "This roster link request was already declined.",
      alreadyResolved: true,
    };
  }
  return {
    ok: false,
    title: "Link already used",
    body: "This approval link has already been used.",
  };
}

async function rosterLinkActionTokenFailure(
  tokenHash: string,
): Promise<RosterLinkActionResult> {
  const db = getDb();
  const [tokenRow] = await db
    .select()
    .from(schema.hqRosterLinkActionTokens)
    .where(eq(schema.hqRosterLinkActionTokens.tokenHash, tokenHash))
    .limit(1);

  if (!tokenRow) {
    return {
      ok: false,
      title: "Invalid link",
      body: "This approval link is not valid. It may have expired or already been used.",
    };
  }

  if (tokenRow.usedAt) {
    return describeUsedRosterLinkActionToken(tokenRow);
  }

  if (tokenRow.expiresAt < new Date()) {
    return {
      ok: false,
      title: "Link expired",
      body: "This approval link has expired. Ask the member to submit their name and UID again.",
    };
  }

  return {
    ok: false,
    title: "Link already used",
    body: "This approval link has already been used.",
  };
}

export async function processRosterLinkActionToken(
  rawToken: string,
): Promise<RosterLinkActionResult> {
  const token = rawToken.trim();
  if (!token) {
    return {
      ok: false,
      title: "Invalid link",
      body: "This approval link is missing or invalid.",
    };
  }

  const tokenHash = hashActionToken(token);
  const now = new Date();
  const db = getDb();
  const [tokenRow] = await db
    .select()
    .from(schema.hqRosterLinkActionTokens)
    .where(eq(schema.hqRosterLinkActionTokens.tokenHash, tokenHash))
    .limit(1);

  if (!tokenRow) {
    return {
      ok: false,
      title: "Invalid link",
      body: "This approval link is not valid. It may have expired or already been used.",
    };
  }

  if (tokenRow.usedAt) {
    return describeUsedRosterLinkActionToken(tokenRow);
  }

  if (tokenRow.expiresAt < now) {
    return {
      ok: false,
      title: "Link expired",
      body: "This approval link has expired. Ask the member to submit their name and UID again.",
    };
  }

  if (tokenRow.action === "accept") {
    const request = await getRosterLinkRequestById(tokenRow.requestId);
    if (!request) {
      return {
        ok: false,
        title: "Could not open review",
        body: "This request is no longer available.",
      };
    }
    const resolveUrl = `${resolveAppOrigin()}/members/roster-link-requests?request=${encodeURIComponent(request.id)}`;
    return {
      ok: true,
      action: "accept",
      title: "Review roster link",
      body: `Sign in to Alliance HQ to match ${request.gameUserName} to the correct roster member.`,
      redirectUrl: resolveUrl,
    };
  }

  const claimed = await claimRosterLinkActionToken(tokenHash, now);
  if (!claimed) {
    return rosterLinkActionTokenFailure(tokenHash);
  }

  const result = await rejectRosterLinkRequest({ requestId: claimed.requestId });
  if (!result.ok) {
    return {
      ok: false,
      title: "Could not decline",
      body: "We could not complete this action. The request may no longer be pending.",
    };
  }

  return {
    ok: true,
    action: "reject",
    title: "Request declined",
    body: "The roster link request was declined. The invitee can contact you if this was a mistake.",
  };
}
