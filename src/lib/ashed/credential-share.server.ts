import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type CredentialShareCapability,
  isCredentialShareCapability,
  parseCredentialShareCapabilities,
} from "@/lib/ashed/credential-share-capabilities.shared";
import { writeCredentialShareAudit } from "@/lib/ashed/credential-share-audit.server";
import { writeAuditLog } from "@/lib/bff/audit";
import type { ParsedConnection } from "@/lib/connectionString";
import { decryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import type {
  AshedCredentialShare,
  AshedCredentialShareEndReason,
  AshedCredentialShareStatus,
} from "@/lib/db/schema";
import { ROLE_IDS } from "@/lib/rbac/constants";
import {
  getAshedCredentialRecord,
  loadSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";

export const MAX_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const OFFICER_PLUS_ROLE_IDS = new Set([
  ROLE_IDS.owner,
  ROLE_IDS.maintainer,
  ROLE_IDS.officer,
]);

export class CredentialShareError extends Error {
  constructor(
    message: string,
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID"
      | "CONFLICT"
      | "NOT_CONNECTED",
  ) {
    super(message);
    this.name = "CredentialShareError";
  }
}

export type CredentialShareSummary = {
  id: string;
  allianceId: string;
  ownerHqUserId: string;
  ownerEmail: string;
  ownerDisplayName: string | null;
  delegateHqUserId: string | null;
  delegateEmail: string | null;
  delegateDisplayName: string | null;
  invitedHqUserId: string;
  status: AshedCredentialShareStatus;
  capabilities: CredentialShareCapability[];
  expiresAt: string | null;
  lastAccessedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
  endReason: AshedCredentialShareEndReason | null;
  createdAt: string;
  updatedAt: string;
};

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toSummary(
  row: AshedCredentialShare,
  users: Map<
    string,
    { email: string; displayName: string | null }
  >,
): CredentialShareSummary {
  const owner = users.get(row.ownerHqUserId);
  const delegate = row.delegateHqUserId
    ? users.get(row.delegateHqUserId)
    : null;
  return {
    id: row.id,
    allianceId: row.allianceId,
    ownerHqUserId: row.ownerHqUserId,
    ownerEmail: owner?.email ?? "",
    ownerDisplayName: owner?.displayName ?? null,
    delegateHqUserId: row.delegateHqUserId,
    delegateEmail: delegate?.email ?? null,
    delegateDisplayName: delegate?.displayName ?? null,
    invitedHqUserId: row.invitedHqUserId,
    status: row.status,
    capabilities: parseCredentialShareCapabilities(row.capabilities),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    endReason: row.endReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadUserMap(
  userIds: string[],
): Promise<Map<string, { email: string; displayName: string | null }>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) {
    return new Map();
  }
  const db = getDb();
  const rows = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
    })
    .from(schema.hqUsers)
    .where(inArray(schema.hqUsers.id, unique));
  return new Map(
    rows.map((row) => [
      row.id,
      { email: row.email, displayName: row.displayName },
    ]),
  );
}

export async function assertOfficerPlusMembership(
  allianceId: string,
  hqUserId: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ roleId: schema.allianceMemberships.roleId })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.allianceMemberships.roleId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.status, "active"),
        inArray(schema.allianceMemberships.roleId, [
          ...OFFICER_PLUS_ROLE_IDS,
        ]),
      ),
    )
    .limit(1);

  if (!row) {
    throw new CredentialShareError(
      "Only alliance officers can receive credential access.",
      "FORBIDDEN",
    );
  }
}

async function assertOwnerSessionCredential(
  sessionId: string,
  allianceId: string,
): Promise<{
  hqUserId: string;
  credential: NonNullable<Awaited<ReturnType<typeof getAshedCredentialRecord>>>;
}> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    throw new CredentialShareError("Sign in before sharing credentials.", "FORBIDDEN");
  }

  const hqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!hqUserId) {
    throw new CredentialShareError("Sign in before sharing credentials.", "FORBIDDEN");
  }

  const credential = await getAshedCredentialRecord(sessionId);
  if (!credential?.encryptedToken) {
    throw new CredentialShareError(
      "Connect your Ashed account before sharing credentials.",
      "NOT_CONNECTED",
    );
  }

  if (
    !(await sessionHoldsAshedIdentityForHqUser(sessionId, hqUserId))
  ) {
    throw new CredentialShareError(
      "Only your own connected Ashed credentials can be shared.",
      "FORBIDDEN",
    );
  }

  if (session.currentAllianceId !== allianceId) {
    throw new CredentialShareError(
      "Switch to this alliance before sharing credentials.",
      "FORBIDDEN",
    );
  }

  return { hqUserId, credential };
}

export async function assertCredentialShareOwnerForAlliance(
  sessionId: string,
  allianceId: string,
): Promise<{ hqUserId: string }> {
  const { hqUserId } = await assertOwnerSessionCredential(sessionId, allianceId);
  return { hqUserId };
}

function validateCapabilities(capabilities: string[]): CredentialShareCapability[] {
  const parsed = capabilities.filter(isCredentialShareCapability);
  if (parsed.length === 0) {
    throw new CredentialShareError(
      "Select at least one capability to share.",
      "INVALID",
    );
  }
  return parsed;
}

function validateTtlHours(ttlHours: number): number {
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 168) {
    throw new CredentialShareError(
      "Access duration must be between 1 hour and 7 days.",
      "INVALID",
    );
  }
  return ttlHours;
}

export async function createCredentialShareInvite(input: {
  sessionId: string;
  allianceId: string;
  invitedHqUserId: string;
  capabilities: string[];
  ttlHours: number;
}): Promise<{ share: CredentialShareSummary; inviteToken: string }> {
  const { hqUserId: ownerHqUserId, credential } =
    await assertOwnerSessionCredential(input.sessionId, input.allianceId);

  if (input.invitedHqUserId === ownerHqUserId) {
    throw new CredentialShareError(
      "You cannot share credentials with yourself.",
      "INVALID",
    );
  }

  await assertOfficerPlusMembership(input.allianceId, input.invitedHqUserId);
  const capabilities = validateCapabilities(input.capabilities);
  const ttlHours = validateTtlHours(input.ttlHours);

  const db = getDb();
  const [blocking] = await db
    .select({ id: schema.ashedCredentialShares.id })
    .from(schema.ashedCredentialShares)
    .where(
      and(
        eq(schema.ashedCredentialShares.allianceId, input.allianceId),
        eq(schema.ashedCredentialShares.ownerHqUserId, ownerHqUserId),
        inArray(schema.ashedCredentialShares.status, ["pending", "active"]),
      ),
    )
    .limit(1);

  if (blocking) {
    throw new CredentialShareError(
      "Revoke or wait for your existing credential share before creating another.",
      "CONFLICT",
    );
  }

  const now = new Date();
  const inviteToken = randomBytes(24).toString("base64url");
  const shareId = nanoid(16);
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  await db.insert(schema.ashedCredentialShares).values({
    id: shareId,
    allianceId: input.allianceId,
    ownerHqUserId,
    invitedHqUserId: input.invitedHqUserId,
    status: "pending",
    capabilities,
    encryptedToken: credential.encryptedToken,
    appId: credential.appId,
    originUrl: credential.originUrl,
    tokenExpiresAt: credential.tokenExpiresAt,
    ashedUserId: credential.ashedUserId,
    expiresAt,
    inviteTokenHash: hashInviteToken(inviteToken),
    createdAt: now,
    updatedAt: now,
  });

  await writeCredentialShareAudit({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: ownerHqUserId,
    shareId,
    action: "ashed_share.invite_created",
    metadata: {
      invitedHqUserId: input.invitedHqUserId,
      capabilities,
      expiresAt: expiresAt.toISOString(),
    },
  });

  const [row] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, shareId))
    .limit(1);

  const users = await loadUserMap([
    ownerHqUserId,
    input.invitedHqUserId,
  ]);

  return {
    share: toSummary(row!, users),
    inviteToken,
  };
}

export async function acceptCredentialShare(input: {
  shareId: string;
  targetSessionId: string;
  acknowledged: boolean;
}): Promise<CredentialShareSummary> {
  if (!input.acknowledged) {
    throw new CredentialShareError(
      "You must acknowledge the delegation terms before accepting.",
      "INVALID",
    );
  }

  const session = await loadSession(input.targetSessionId);
  if (!session?.hqUserId) {
    throw new CredentialShareError("Sign in before accepting.", "FORBIDDEN");
  }

  const delegateHqUserId = await resolveEffectiveHqUserIdForSession(
    input.targetSessionId,
    session.hqUserId,
  );
  if (!delegateHqUserId) {
    throw new CredentialShareError("Sign in before accepting.", "FORBIDDEN");
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, input.shareId))
    .limit(1);

  if (!row || row.status !== "pending") {
    throw new CredentialShareError("This invite is no longer available.", "NOT_FOUND");
  }

  if (row.invitedHqUserId !== delegateHqUserId) {
    throw new CredentialShareError(
      "This invite was sent to a different officer.",
      "FORBIDDEN",
    );
  }

  await assertOfficerPlusMembership(row.allianceId, delegateHqUserId);

  const [delegateConflict] = await db
    .select({ id: schema.ashedCredentialShares.id })
    .from(schema.ashedCredentialShares)
    .where(
      and(
        eq(schema.ashedCredentialShares.allianceId, row.allianceId),
        eq(schema.ashedCredentialShares.delegateHqUserId, delegateHqUserId),
        eq(schema.ashedCredentialShares.status, "active"),
      ),
    )
    .limit(1);

  if (delegateConflict) {
    throw new CredentialShareError(
      "You already have active delegated credentials in this alliance.",
      "CONFLICT",
    );
  }

  const now = new Date();
  await db
    .update(schema.ashedCredentialShares)
    .set({
      status: "active",
      delegateHqUserId,
      acceptedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.ashedCredentialShares.id, row.id));

  await writeCredentialShareAudit({
    sessionId: input.targetSessionId,
    allianceId: row.allianceId,
    hqUserId: delegateHqUserId,
    shareId: row.id,
    action: "ashed_share.accepted",
    metadata: {
      ownerHqUserId: row.ownerHqUserId,
      capabilities: row.capabilities,
    },
  });

  const [updated] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, row.id))
    .limit(1);

  const users = await loadUserMap([
    row.ownerHqUserId,
    delegateHqUserId,
  ]);
  return toSummary(updated!, users);
}

export async function rejectCredentialShare(input: {
  shareId: string;
  sessionId: string;
}): Promise<void> {
  const session = await loadSession(input.sessionId);
  const hqUserId = session?.hqUserId
    ? await resolveEffectiveHqUserIdForSession(input.sessionId, session.hqUserId)
    : null;

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, input.shareId))
    .limit(1);

  if (!row || row.status !== "pending") {
    throw new CredentialShareError("This invite is no longer available.", "NOT_FOUND");
  }

  if (hqUserId !== row.invitedHqUserId && hqUserId !== row.ownerHqUserId) {
    throw new CredentialShareError("You cannot reject this invite.", "FORBIDDEN");
  }

  const now = new Date();
  await db
    .update(schema.ashedCredentialShares)
    .set({
      status: "rejected",
      rejectedAt: now,
      endReason: "rejected",
      updatedAt: now,
    })
    .where(eq(schema.ashedCredentialShares.id, row.id));

  await writeCredentialShareAudit({
    sessionId: input.sessionId,
    allianceId: row.allianceId,
    hqUserId: hqUserId ?? row.invitedHqUserId,
    shareId: row.id,
    action: "ashed_share.rejected",
    metadata: { ownerHqUserId: row.ownerHqUserId },
  });
}

export async function revokeCredentialShare(input: {
  shareId: string;
  sessionId: string;
  hqUserId: string;
  isPlatformMaintainer?: boolean;
}): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, input.shareId))
    .limit(1);

  if (!row || !["pending", "active"].includes(row.status)) {
    throw new CredentialShareError("This share is not active.", "NOT_FOUND");
  }

  const isOwner = row.ownerHqUserId === input.hqUserId;
  if (!isOwner && !input.isPlatformMaintainer) {
    throw new CredentialShareError("Only the credential owner can revoke access.", "FORBIDDEN");
  }

  const now = new Date();
  await db
    .update(schema.ashedCredentialShares)
    .set({
      status: "revoked",
      revokedAt: now,
      endReason: "revoked",
      updatedAt: now,
    })
    .where(eq(schema.ashedCredentialShares.id, row.id));

  await writeCredentialShareAudit({
    sessionId: input.sessionId,
    allianceId: row.allianceId,
    hqUserId: input.hqUserId,
    shareId: row.id,
    action: "ashed_share.revoked",
    metadata: {
      ownerHqUserId: row.ownerHqUserId,
      delegateHqUserId: row.delegateHqUserId,
    },
  });
}

export async function getActiveShareForDelegate(
  allianceId: string,
  delegateHqUserId: string,
): Promise<AshedCredentialShare | null> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(
      and(
        eq(schema.ashedCredentialShares.allianceId, allianceId),
        eq(schema.ashedCredentialShares.delegateHqUserId, delegateHqUserId),
        eq(schema.ashedCredentialShares.status, "active"),
      ),
    )
    .limit(1);

  if (!row?.expiresAt || row.expiresAt <= now) {
    return null;
  }

  if (row.tokenExpiresAt && row.tokenExpiresAt <= now) {
    return null;
  }

  return row;
}

export async function sessionUsesDelegatedCredential(
  sessionId: string,
  allianceId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return false;
  }
  const hqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!hqUserId) {
    return false;
  }
  if (await sessionHoldsAshedIdentityForHqUser(sessionId, hqUserId)) {
    return false;
  }
  const share = await getActiveShareForDelegate(allianceId, hqUserId);
  return share !== null;
}

export async function resolveAshedConnectionForAlliance(
  sessionId: string,
  allianceId: string,
): Promise<{
  connection: ParsedConnection;
  shareId: string | null;
  isDelegated: boolean;
} | null> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return null;
  }

  const hqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!hqUserId) {
    return null;
  }

  if (await sessionHoldsAshedIdentityForHqUser(sessionId, hqUserId)) {
    const credential = await getAshedCredentialRecord(sessionId);
    if (!credential?.encryptedToken) {
      return null;
    }
    return {
      connection: {
        appId: credential.appId,
        originUrl: credential.originUrl,
        token: decryptSecret(credential.encryptedToken),
      },
      shareId: null,
      isDelegated: false,
    };
  }

  const share = await getActiveShareForDelegate(allianceId, hqUserId);
  if (!share?.encryptedToken || share.allianceId !== allianceId) {
    return null;
  }

  const now = new Date();
  await getDb()
    .update(schema.ashedCredentialShares)
    .set({ lastAccessedAt: now, updatedAt: now })
    .where(eq(schema.ashedCredentialShares.id, share.id));

  return {
    connection: {
      appId: share.appId!,
      originUrl: share.originUrl!,
      token: decryptSecret(share.encryptedToken),
    },
    shareId: share.id,
    isDelegated: true,
  };
}

export async function requireActiveShareCapability(input: {
  sessionId: string;
  allianceId: string;
  capability: CredentialShareCapability;
  delegatedAction: string;
}): Promise<{
  connection: ParsedConnection;
  shareId: string;
  ownerHqUserId: string;
}> {
  const resolved = await resolveAshedConnectionForAlliance(
    input.sessionId,
    input.allianceId,
  );
  if (!resolved?.isDelegated || !resolved.shareId) {
    throw new CredentialShareError(
      "Delegated Ashed credentials are required for this action.",
      "FORBIDDEN",
    );
  }

  const db = getDb();
  const [share] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, resolved.shareId))
    .limit(1);

  if (!share) {
    throw new CredentialShareError("Delegated credentials not found.", "NOT_FOUND");
  }

  const capabilities = parseCredentialShareCapabilities(share.capabilities);
  if (!capabilities.includes(input.capability)) {
    throw new CredentialShareError(
      "This credential share does not include that capability.",
      "FORBIDDEN",
    );
  }

  const session = await loadSession(input.sessionId);
  const hqUserId = session?.hqUserId
    ? await resolveEffectiveHqUserIdForSession(input.sessionId, session.hqUserId)
    : null;

  await writeCredentialShareAudit({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: hqUserId ?? share.delegateHqUserId ?? "",
    shareId: share.id,
    action: "ashed_share.used",
    metadata: {
      capability: input.capability,
      delegatedAction: input.delegatedAction,
      ownerHqUserId: share.ownerHqUserId,
      delegateHqUserId: share.delegateHqUserId,
    },
  });

  return {
    connection: resolved.connection,
    shareId: share.id,
    ownerHqUserId: share.ownerHqUserId,
  };
}

export async function refreshActiveShareSnapshotsForOwner(
  ownerHqUserId: string,
  sessionId: string,
): Promise<number> {
  const credential = await getAshedCredentialRecord(sessionId);
  if (!credential?.encryptedToken) {
    return 0;
  }

  const db = getDb();
  const rows = await db
    .select({ id: schema.ashedCredentialShares.id })
    .from(schema.ashedCredentialShares)
    .where(
      and(
        eq(schema.ashedCredentialShares.ownerHqUserId, ownerHqUserId),
        inArray(schema.ashedCredentialShares.status, ["pending", "active"]),
      ),
    );

  if (rows.length === 0) {
    return 0;
  }

  const now = new Date();
  await db
    .update(schema.ashedCredentialShares)
    .set({
      encryptedToken: credential.encryptedToken,
      appId: credential.appId,
      originUrl: credential.originUrl,
      tokenExpiresAt: credential.tokenExpiresAt,
      ashedUserId: credential.ashedUserId,
      updatedAt: now,
    })
    .where(
      inArray(
        schema.ashedCredentialShares.id,
        rows.map((row) => row.id),
      ),
    );

  return rows.length;
}

export async function listCredentialSharesForAlliance(
  allianceId: string,
): Promise<CredentialShareSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.allianceId, allianceId))
    .orderBy(desc(schema.ashedCredentialShares.updatedAt));

  const userIds = rows.flatMap((row) => [
    row.ownerHqUserId,
    row.delegateHqUserId,
    row.invitedHqUserId,
  ]);
  const users = await loadUserMap(userIds.filter((id): id is string => Boolean(id)));
  return rows.map((row) => toSummary(row, users));
}

export async function listCredentialSharesForHqUser(
  hqUserId: string,
): Promise<CredentialShareSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(
      or(
        eq(schema.ashedCredentialShares.ownerHqUserId, hqUserId),
        eq(schema.ashedCredentialShares.delegateHqUserId, hqUserId),
        eq(schema.ashedCredentialShares.invitedHqUserId, hqUserId),
      ),
    )
    .orderBy(desc(schema.ashedCredentialShares.updatedAt));

  const userIds = rows.flatMap((row) => [
    row.ownerHqUserId,
    row.delegateHqUserId,
    row.invitedHqUserId,
  ]);
  const users = await loadUserMap(userIds.filter((id): id is string => Boolean(id)));
  return rows.map((row) => toSummary(row, users));
}

export async function expireStaleCredentialShares(): Promise<{
  expired: number;
  tokenExpired: number;
  membershipEnded: number;
}> {
  const db = getDb();
  const now = new Date();
  let expired = 0;
  let tokenExpired = 0;
  let membershipEnded = 0;

  const activeRows = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(inArray(schema.ashedCredentialShares.status, ["pending", "active"]));

  for (const row of activeRows) {
    let endReason: AshedCredentialShareEndReason | null = null;

    if (row.expiresAt && row.expiresAt <= now) {
      endReason = "expired";
    } else if (row.tokenExpiresAt && row.tokenExpiresAt <= now) {
      endReason = "owner_token_expired";
    } else if (row.status === "active" && row.delegateHqUserId) {
      try {
        await assertOfficerPlusMembership(row.allianceId, row.delegateHqUserId);
        await assertOfficerPlusMembership(row.allianceId, row.ownerHqUserId);
      } catch {
        endReason = "membership_ended";
      }
    }

    if (!endReason) {
      continue;
    }

    await db
      .update(schema.ashedCredentialShares)
      .set({
        status: "expired",
        endReason,
        updatedAt: now,
      })
      .where(eq(schema.ashedCredentialShares.id, row.id));

    await writeAuditLog({
      sessionId: null,
      allianceId: row.allianceId,
      hqUserId: row.ownerHqUserId,
      action: "ashed_share.expired",
      resourceType: "ashed_credential_share",
      resourceId: row.id,
      metadata: {
        endReason,
        delegateHqUserId: row.delegateHqUserId,
      },
    });

    if (endReason === "expired") expired += 1;
    else if (endReason === "owner_token_expired") tokenExpired += 1;
    else membershipEnded += 1;
  }

  return { expired, tokenExpired, membershipEnded };
}

export async function listVideoShareDelegateCandidates(
  allianceId: string,
): Promise<
  Array<{
    hqUserId: string;
    email: string;
    displayName: string | null;
    shareId: string;
    ownerDisplayName: string | null;
    ownerEmail: string;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      shareId: schema.ashedCredentialShares.id,
      delegateHqUserId: schema.ashedCredentialShares.delegateHqUserId,
      ownerEmail: schema.hqUsers.email,
      ownerDisplayName: schema.hqUsers.displayName,
      capabilities: schema.ashedCredentialShares.capabilities,
    })
    .from(schema.ashedCredentialShares)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.ashedCredentialShares.ownerHqUserId),
    )
    .where(
      and(
        eq(schema.ashedCredentialShares.allianceId, allianceId),
        eq(schema.ashedCredentialShares.status, "active"),
      ),
    );

  const candidates = [];
  for (const row of rows) {
    if (!row.delegateHqUserId) continue;
    const capabilities = parseCredentialShareCapabilities(row.capabilities);
    if (!capabilities.includes("video:process")) continue;

    const [delegate] = await db
      .select({
        email: schema.hqUsers.email,
        displayName: schema.hqUsers.displayName,
      })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, row.delegateHqUserId))
      .limit(1);

    if (!delegate) continue;

    candidates.push({
      hqUserId: row.delegateHqUserId,
      email: delegate.email,
      displayName: delegate.displayName,
      shareId: row.shareId,
      ownerDisplayName: row.ownerDisplayName,
      ownerEmail: row.ownerEmail,
    });
  }

  return candidates.filter(() => true);
}

export async function findShareByPairingMetadata(
  metadata: Record<string, unknown>,
): Promise<AshedCredentialShare | null> {
  const shareId = metadata.shareId;
  if (typeof shareId !== "string" || !shareId.trim()) {
    return null;
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.ashedCredentialShares)
    .where(eq(schema.ashedCredentialShares.id, shareId))
    .limit(1);
  return row ?? null;
}
