import "server-only";

import { createHash, randomBytes } from "crypto";

import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { assignManualMembership } from "@/lib/rbac/admin-users";
import {
  ROLE_IDS,
  type SystemRoleName,
} from "@/lib/rbac/constants";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

const INVITE_TTL_DAYS = 14;

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function inviteAcceptUrl(token: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/invite/${encodeURIComponent(token)}`;
}

export type CreateHqInviteInput = {
  allianceId: string;
  email: string;
  roleName: SystemRoleName;
  invitedByHqUserId?: string | null;
  origin: string;
};

export type CreateHqInviteResult = {
  inviteId: string;
  inviteUrl: string;
  expiresAt: string;
  email: string;
  roleName: SystemRoleName;
};

export async function createHqInvite(
  input: CreateHqInviteInput,
): Promise<CreateHqInviteResult> {
  const email = normalizeAshedEmail(input.email.trim());
  if (!email) {
    throw new Error("Invite email is required.");
  }

  const roleId = ROLE_IDS[input.roleName];
  if (!roleId) {
    throw new Error("Invalid invite role.");
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
      operatingMode: schema.alliances.operatingMode,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance) {
    throw new Error("Alliance not found.");
  }
  if (alliance.operatingMode !== "native") {
    throw new Error("Invites are only supported for native alliances.");
  }

  const { token, tokenHash } = generateInviteToken();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);
  const inviteId = nanoid(16);

  await db.insert(schema.hqInvites).values({
    id: inviteId,
    allianceId: input.allianceId,
    email,
    roleId,
    tokenHash,
    invitedByHqUserId: input.invitedByHqUserId ?? null,
    expiresAt,
    createdAt: now,
  });

  return {
    inviteId,
    inviteUrl: inviteAcceptUrl(token, input.origin),
    expiresAt: expiresAt.toISOString(),
    email,
    roleName: input.roleName,
  };
}

export type HqInvitePreview = {
  allianceName: string;
  allianceTag: string | null;
  roleName: SystemRoleName | null;
  expiresAt: string;
  expired: boolean;
  accepted: boolean;
};

export async function loadHqInvitePreview(
  token: string,
): Promise<HqInvitePreview | null> {
  const tokenHash = hashInviteToken(token.trim());
  const db = getDb();
  const [row] = await db
    .select({
      expiresAt: schema.hqInvites.expiresAt,
      acceptedAt: schema.hqInvites.acceptedAt,
      roleId: schema.hqInvites.roleId,
      allianceName: schema.alliances.name,
      allianceTag: schema.alliances.tag,
    })
    .from(schema.hqInvites)
    .innerJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.hqInvites.allianceId),
    )
    .where(eq(schema.hqInvites.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;

  const now = new Date();
  return {
    allianceName: row.allianceName,
    allianceTag: row.allianceTag,
    roleName: systemRoleNameForId(row.roleId),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt <= now,
    accepted: row.acceptedAt != null,
  };
}

async function upsertHqUserByEmail(email: string, displayName?: string | null) {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  if (existing) {
    if (displayName?.trim() && !existing.displayName) {
      await db
        .update(schema.hqUsers)
        .set({ displayName: displayName.trim(), updatedAt: now })
        .where(eq(schema.hqUsers.id, existing.id));
    }
    return existing.id;
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email,
    displayName: displayName?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export type AcceptHqInviteInput = {
  token: string;
  sessionId: string;
  email: string;
  displayName?: string | null;
};

export type AcceptHqInviteResult = {
  allianceId: string;
  allianceTag: string;
  allianceName: string;
  hqUserId: string;
  roleName: SystemRoleName | null;
};

export async function acceptHqInvite(
  input: AcceptHqInviteInput,
): Promise<AcceptHqInviteResult> {
  const tokenHash = hashInviteToken(input.token.trim());
  const submittedEmail = normalizeAshedEmail(input.email.trim());
  if (!submittedEmail) {
    throw new Error("Email is required.");
  }

  const db = getDb();
  const [invite] = await db
    .select()
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.tokenHash, tokenHash),
        isNull(schema.hqInvites.acceptedAt),
      ),
    )
    .limit(1);

  if (!invite) {
    throw new Error("Invite not found or already used.");
  }

  if (invite.expiresAt <= new Date()) {
    throw new Error("Invite has expired.");
  }

  if (submittedEmail !== normalizeAshedEmail(invite.email)) {
    throw new Error("Email does not match this invite.");
  }

  const [alliance] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.id, invite.allianceId))
    .limit(1);

  if (!alliance?.tag?.trim()) {
    throw new Error("Alliance tag is missing.");
  }

  const hqUserId = await upsertHqUserByEmail(submittedEmail, input.displayName);
  await assignManualMembership({
    hqUserId,
    allianceId: invite.allianceId,
    roleId: invite.roleId,
  });

  const now = new Date();
  await db
    .update(schema.hqInvites)
    .set({
      acceptedAt: now,
      acceptedByHqUserId: hqUserId,
    })
    .where(eq(schema.hqInvites.id, invite.id));

  const roleName = systemRoleNameForId(invite.roleId);
  if (roleName === "owner") {
    await db
      .update(schema.alliances)
      .set({
        ownerHqUserId: hqUserId,
        ownerEmail: submittedEmail,
        updatedAt: now,
      })
      .where(eq(schema.alliances.id, invite.allianceId));
  }

  const tag = alliance.tag.trim();
  await db
    .update(schema.sessions)
    .set({
      hqUserId,
      currentAllianceId: invite.allianceId,
      allianceTag: tag,
      allianceId: invite.allianceId,
      userLabel: input.displayName?.trim() || submittedEmail,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, input.sessionId));

  return {
    allianceId: invite.allianceId,
    allianceTag: tag,
    allianceName: alliance.name,
    hqUserId,
    roleName,
  };
}
