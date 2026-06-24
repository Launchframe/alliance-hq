import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { resolveAppOrigin } from "@/lib/app-origin";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import type { MemberLinkApiResponse } from "@/lib/member-link/outcome.shared";
import {
  linkHqMember,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import { createMemberLinkTranslator } from "@/lib/member-link/translate.server";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";

const INVITE_MEMBER_LINK_KINDS = ["email", "protected_link"] as const;
const ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

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
  hqUserId: string;
  inviteId: string;
  reportedName: string;
  gameUid: string;
  gameUserName: string;
  gameServerNumber: number;
  gameUserLevel?: number;
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
    inviteId: input.inviteId,
    reportedName: input.reportedName,
    gameUid: input.gameUid,
    gameUserName: input.gameUserName,
    gameServerNumber: input.gameServerNumber,
    gameUserLevel: input.gameUserLevel ?? null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  const tokens = await insertActionTokens(requestId);

  await saveHqMemberLinkPending(input.allianceId, input.hqUserId, {
    kind: "link_awaiting_owner",
    requestId,
    gameUserName: input.gameUserName,
  });

  await notifyAllianceOwnerOfRosterLinkRequest({
    allianceId: input.allianceId,
    reportedName: input.reportedName,
    gameUserName: input.gameUserName,
    gameUid: input.gameUid,
    acceptToken: tokens.acceptToken,
    rejectToken: tokens.rejectToken,
  });

  return { requestId, ...tokens };
}

async function resolveAllianceOwnerEmail(
  allianceId: string,
): Promise<string | null> {
  const db = getDb();
  const [alliance] = await db
    .select({
      ownerEmail: schema.alliances.ownerEmail,
      ownerHqUserId: schema.alliances.ownerHqUserId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (alliance?.ownerEmail?.trim()) {
    return alliance.ownerEmail.trim();
  }

  if (alliance?.ownerHqUserId) {
    const [owner] = await db
      .select({ email: schema.hqUsers.email })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, alliance.ownerHqUserId))
      .limit(1);
    return owner?.email?.trim() ?? null;
  }

  return null;
}

async function notifyAllianceOwnerOfRosterLinkRequest(input: {
  allianceId: string;
  reportedName: string;
  gameUserName: string;
  gameUid: string;
  acceptToken: string;
  rejectToken: string;
}): Promise<void> {
  if (process.env.E2E_TEST === "true") {
    return;
  }

  const ownerEmail = await resolveAllianceOwnerEmail(input.allianceId);
  if (!ownerEmail) {
    console.warn(
      "[roster-link] No owner email for alliance — approval links not sent:",
      input.allianceId,
    );
    return;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[roster-link] RESEND_API_KEY missing — owner approval email not sent",
    );
    return;
  }

  const origin = resolveAppOrigin();
  const acceptUrl = `${origin}/api/roster-link-requests/action?token=${encodeURIComponent(input.acceptToken)}`;
  const rejectUrl = `${origin}/api/roster-link-requests/action?token=${encodeURIComponent(input.rejectToken)}`;
  const subject = `Roster link request: ${input.gameUserName}`;
  const text = [
    `An invited member requested to link their in-game character to Alliance HQ.`,
    ``,
    `Reported name: ${input.reportedName}`,
    `Game name (Last War): ${input.gameUserName}`,
    `Player UID: ${input.gameUid}`,
    ``,
    `Approve: ${acceptUrl}`,
    `Decline: ${rejectUrl}`,
    ``,
    `These links expire in 7 days and can each be used once.`,
  ].join("\n");
  const html = [
    `<p>An invited member requested to link their in-game character to Alliance HQ.</p>`,
    `<ul>`,
    `<li><strong>Reported name:</strong> ${escapeHtml(input.reportedName)}</li>`,
    `<li><strong>Game name (Last War):</strong> ${escapeHtml(input.gameUserName)}</li>`,
    `<li><strong>Player UID:</strong> ${escapeHtml(input.gameUid)}</li>`,
    `</ul>`,
    `<p><a href="${acceptUrl}">Approve roster link</a></p>`,
    `<p><a href="${rejectUrl}">Decline request</a></p>`,
    `<p>These links expire in 7 days and can each be used once.</p>`,
  ].join("");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resolveEmailFromAddress(),
      to: ownerEmail,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    console.error(
      "[roster-link] Owner approval email failed:",
      await res.text(),
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function tryRouteRosterMissToOwnerApproval(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  reportedName: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
}): Promise<MemberLinkApiResponse | null> {
  const translate = createMemberLinkTranslator(input.locale);
  const playerServer = input.lookup.gameServerNumber;

  if (playerServer == null) {
    return {
      outcome: "wrong_server",
      message: translate("wrongServer"),
      pending: null,
    };
  }

  const allianceServer = await resolveAllianceGameServerNumber(input.allianceId);
  if (allianceServer == null || playerServer !== allianceServer) {
    return {
      outcome: "wrong_server",
      message: translate("wrongServer"),
      pending: null,
    };
  }

  const invite = await findAcceptedInviteForMemberLink(
    input.allianceId,
    input.hqUserId,
  );
  if (!invite) {
    return null;
  }

  const { requestId } = await createRosterLinkRequest({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    inviteId: invite.id,
    reportedName: input.reportedName,
    gameUid: input.gameUid,
    gameUserName: input.lookup.gameUserName,
    gameServerNumber: playerServer,
    gameUserLevel: input.lookup.gameUserLevel,
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

export async function acceptRosterLinkRequest(input: {
  requestId: string;
  resolvedByHqUserId?: string | null;
  sessionId?: string | null;
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
  let ashedMemberId = request.createdMemberId;

  if (!ashedMemberId) {
    ashedMemberId = await createNativeAllianceMemberForRosterLink({
      allianceId: request.allianceId,
      gameUserName: request.gameUserName,
      gameUserLevel: request.gameUserLevel,
    });
  }

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
  const claimed = await claimRosterLinkActionToken(tokenHash, now);
  if (!claimed) {
    return rosterLinkActionTokenFailure(tokenHash);
  }

  if (claimed.action === "accept") {
    const result = await acceptRosterLinkRequest({ requestId: claimed.requestId });
    if (!result.ok) {
      return {
        ok: false,
        title: "Could not approve",
        body: "We could not complete this approval. The request may no longer be pending.",
      };
    }
    return {
      ok: true,
      action: "accept",
      title: "Member approved",
      body: `${result.memberName} can now continue linking in Alliance HQ.`,
    };
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
