import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { isBootstrapEmailMatch } from "@/lib/rbac/bootstrap-platform.helpers";

type HqUserAccessRow = {
  id: string;
  email: string;
  isPlatformMaintainer: number;
  accessGrantedAt: Date | null;
};

function parseEnvFlag(
  value: string | undefined,
): boolean | null {
  const flag = value?.trim().toLowerCase();
  if (!flag) {
    return null;
  }
  if (flag === "false" || flag === "0" || flag === "off") {
    return false;
  }
  if (flag === "true" || flag === "1" || flag === "on") {
    return true;
  }
  return null;
}

function rowHasInvitedAccess(row: HqUserAccessRow): boolean {
  if (row.isPlatformMaintainer === 1) {
    return true;
  }
  return row.accessGrantedAt != null;
}

/** Native / free-tester path always requires an admin invite — not feature-flagged. */
export function isNativeInviteRequired(): boolean {
  return true;
}

/**
 * Ashed connection-key users: invite required when this flag is on.
 * HQ_ASHED_INVITE_REQUIRED (preferred) or legacy HQ_INVITE_REQUIRED.
 * Defaults to on when VERCEL_ENV=production.
 */
export function isAshedInviteRequired(): boolean {
  const explicit =
    parseEnvFlag(process.env.HQ_ASHED_INVITE_REQUIRED) ??
    parseEnvFlag(process.env.HQ_INVITE_REQUIRED);
  if (explicit != null) {
    return explicit;
  }
  return process.env.VERCEL_ENV === "production";
}

/** @deprecated Use isAshedInviteRequired */
export function isProductionInviteGateEnabled(): boolean {
  return isAshedInviteRequired();
}

async function bootstrapConnectAllowed(email: string): Promise<boolean> {
  if (!isBootstrapEmailMatch(email, process.env.PLATFORM_BOOTSTRAP_EMAIL)) {
    return false;
  }

  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.isPlatformMaintainer, 1));

  return (row?.count ?? 0) === 0;
}

export async function grantHqAccess(hqUserId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.hqUsers)
    .set({ accessGrantedAt: now, updatedAt: now })
    .where(eq(schema.hqUsers.id, hqUserId));
}

async function loadHqUserAccessRow(
  hqUserId: string,
): Promise<HqUserAccessRow | null> {
  const db = getDb();
  const [user] = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer,
      accessGrantedAt: schema.hqUsers.accessGrantedAt,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  return user ?? null;
}

export async function hqUserHasAccessGrant(hqUserId: string): Promise<boolean> {
  const user = await loadHqUserAccessRow(hqUserId);
  if (!user) {
    return false;
  }
  return rowHasInvitedAccess(user);
}

export async function hqUserHasInvitedAccess(hqUserId: string): Promise<boolean> {
  return hqUserHasAccessGrant(hqUserId);
}

/** Gate for Ashed POST /api/auth/connect when isAshedInviteRequired(). */
export async function emailHasAshedConnectAccess(email: string): Promise<boolean> {
  if (!isAshedInviteRequired()) {
    return true;
  }

  if (await bootstrapConnectAllowed(email)) {
    return true;
  }

  const normalized = normalizeAshedEmail(email.trim());
  if (!normalized) {
    return false;
  }

  const db = getDb();
  const [user] = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer,
      accessGrantedAt: schema.hqUsers.accessGrantedAt,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (!user) {
    return false;
  }

  return rowHasInvitedAccess(user);
}

/** @deprecated Use emailHasAshedConnectAccess */
export async function emailHasInvitedAccess(email: string): Promise<boolean> {
  return emailHasAshedConnectAccess(email);
}

/**
 * Returns false when the email belongs to an HQ user who holds an active
 * member-role membership on any alliance. Member accounts must not connect
 * Ashed, even from a fresh session where hqUserId is not yet bound.
 */
export async function emailHasAshedConnectPermission(
  email: string,
): Promise<boolean> {
  const normalized = normalizeAshedEmail(email.trim());
  if (!normalized) {
    return false;
  }

  const db = getDb();
  const [user] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (!user) {
    return true;
  }

  const [blocked] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.allianceMemberships.roleId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, user.id),
        eq(schema.allianceMemberships.status, "active"),
        eq(schema.roles.name, "member"),
      ),
    )
    .limit(1);

  return !blocked;
}
