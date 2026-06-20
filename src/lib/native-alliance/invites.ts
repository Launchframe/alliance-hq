import "server-only";

import { createHash, randomBytes } from "crypto";

import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { grantHqAccess } from "@/lib/access/invite-gate";
import { getDb, schema } from "@/lib/db";
import { assignManualMembership } from "@/lib/rbac/admin-users";
import {
  ASHED_CONNECT_PERMISSION,
  ROLE_IDS,
  type SystemRoleName,
} from "@/lib/rbac/constants";
import {
  resolveInviteRedirect,
  resolvePostInviteOnboardingRedirect,
  sanitizeInternalRedirectPath,
} from "@/lib/navigation/safe-redirect.shared";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

const INVITE_TTL_DAYS = 14;

async function ensureSystemRoleSeeded(
  roleName: SystemRoleName,
): Promise<void> {
  const db = getDb();
  const roleId = ROLE_IDS[roleName];

  const [existingRole] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.id, roleId))
    .limit(1);

  if (!existingRole) {
    await db
      .insert(schema.roles)
      .values({
        id: roleId,
        allianceId: null,
        name: roleName,
        description:
          roleName === "member"
            ? "HQ member — read-only access to alliance resources and personal account settings"
            : `${roleName} system role`,
        isSystem: 1,
      })
      .onConflictDoNothing();
  }

  if (roleName !== "member") {
    await db
      .insert(schema.permissions)
      .values({
        id: ASHED_CONNECT_PERMISSION,
        description: "Connect an Ashed account to HQ",
      })
      .onConflictDoNothing();

    await db
      .insert(schema.rolePermissions)
      .values({ roleId, permissionId: ASHED_CONNECT_PERMISSION })
      .onConflictDoNothing();
    return;
  }

  // Backfill member permissions from viewer if seed drift left this role unconfigured.
  const [existingMemberPerm] = await db
    .select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, roleId))
    .limit(1);

  if (existingMemberPerm) {
    return;
  }

  const viewerRoleId = ROLE_IDS.viewer;
  const viewerPerms = await db
    .select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, viewerRoleId));

  if (viewerPerms.length === 0) {
    return;
  }

  await Promise.all(
    viewerPerms.map((row) =>
      db
        .insert(schema.rolePermissions)
        .values({ roleId, permissionId: row.permissionId })
        .onConflictDoNothing(),
    ),
  );
}

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function inviteAcceptUrl(
  token: string,
  origin: string,
  redirectPath?: string | null,
): string {
  const base = `${origin.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  const safeRedirect = sanitizeInternalRedirectPath(redirectPath);
  if (!safeRedirect) {
    return base;
  }
  return `${base}?next=${encodeURIComponent(safeRedirect)}`;
}

export type CreateHqInviteInput = {
  allianceId: string;
  email: string;
  roleName: SystemRoleName;
  invitedByHqUserId?: string | null;
  origin: string;
  redirectPath?: string | null;
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

  await ensureSystemRoleSeeded(input.roleName);

  const db = getDb();
  const [alliance] = await db
    .select({
      id: schema.alliances.id,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance) {
    throw new Error("Alliance not found.");
  }

  const redirectPath = sanitizeInternalRedirectPath(input.redirectPath);
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
    redirectPath,
    expiresAt,
    createdAt: now,
  });

  return {
    inviteId,
    inviteUrl: inviteAcceptUrl(token, input.origin, redirectPath),
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
  redirectPath: string | null;
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
      redirectPath: schema.hqInvites.redirectPath,
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
    redirectPath: row.redirectPath,
  };
}

export function resolveHqInviteAcceptRedirect(options: {
  queryNext?: string | null;
  storedPath?: string | null;
}): string {
  return resolvePostInviteOnboardingRedirect(options);
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
  redirectPath: string | null;
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
  await grantHqAccess(hqUserId);
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
    redirectPath: invite.redirectPath,
  };
}
