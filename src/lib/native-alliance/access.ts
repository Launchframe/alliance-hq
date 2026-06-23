import "server-only";

import { and, eq } from "drizzle-orm";

import {
  emailHasAshedConnectAccess,
  hqUserHasAccessGrant,
  isAshedInviteRequired,
  isNativeInviteRequired,
} from "@/lib/access/invite-gate";
import { getDb, schema } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import {
  ashedSourcedMembershipIsActiveForSession,
  sessionHoldsAshedIdentityForHqUser,
} from "@/lib/rbac/ashed-session-membership";
import {
  getAshedConnection,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";

import { getAllianceOperatingMode } from "./operating-mode";
import { ASHED_CONNECT_PERMISSION } from "@/lib/rbac/constants";
import { sessionHasHqMemberLink } from "@/lib/member-link/repository.server";

/**
 * Ashed connect UI/API is blocked only for bound sessions whose active alliance
 * role lacks `ashed:connect` (e.g. member-only invites). Fresh sign-ins with
 * hqUserId but no membership must still reach /connect from get-started.
 */
export function rbacAllowsAshedConnect(
  rbac: { isPlatformMaintainer: boolean; permissions: Set<string> } | null,
  hasActiveMembership: boolean,
): boolean {
  if (!rbac) {
    return true;
  }
  if (rbac.isPlatformMaintainer) {
    return true;
  }
  if (!hasActiveMembership) {
    return true;
  }
  return rbac.permissions.has(ASHED_CONNECT_PERMISSION);
}

export async function sessionHasActiveMembership(
  session: Session,
): Promise<boolean> {
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!effectiveHqUserId || !session.currentAllianceId) {
    return false;
  }

  const db = getDb();
  const [membership] = await db
    .select({
      id: schema.allianceMemberships.id,
      source: schema.allianceMemberships.source,
    })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, effectiveHqUserId),
        eq(schema.allianceMemberships.allianceId, session.currentAllianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!membership) {
    return false;
  }

  const holdsAshedIdentity = await sessionHoldsAshedIdentityForHqUser(
    session.id,
    effectiveHqUserId,
  );

  return ashedSourcedMembershipIsActiveForSession(
    membership.source,
    holdsAshedIdentity,
  );
}

export async function sessionHasNativeMembership(
  session: Session,
): Promise<boolean> {
  if (!(await sessionHasActiveMembership(session))) {
    return false;
  }

  if (!session.currentAllianceId) {
    return false;
  }

  const mode = await getAllianceOperatingMode(session.currentAllianceId);
  return mode === "native";
}

/** Native members must link HQ user to roster row before using the app shell. */
export async function sessionRequiresMemberLink(session: Session): Promise<boolean> {
  if (!(await sessionHasNativeMembership(session))) {
    return false;
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!effectiveHqUserId || !session.currentAllianceId) {
    return false;
  }

  const linked = await sessionHasHqMemberLink(
    session.currentAllianceId,
    effectiveHqUserId,
  );
  return !linked;
}

async function sessionPassesNativeInviteGate(
  effectiveHqUserId: string | null,
): Promise<boolean> {
  if (!isNativeInviteRequired()) {
    return true;
  }
  if (!effectiveHqUserId) {
    return false;
  }
  return hqUserHasAccessGrant(effectiveHqUserId);
}

async function sessionPassesAshedInviteGate(
  effectiveHqUserId: string | null,
): Promise<boolean> {
  if (!isAshedInviteRequired()) {
    return true;
  }
  if (!effectiveHqUserId) {
    return false;
  }
  return hqUserHasAccessGrant(effectiveHqUserId);
}

/**
 * App shell access:
 * - Native alliance members always need an admin invite (accessGrantedAt).
 * - Ashed connection-key users need an invite only when HQ_ASHED_INVITE_REQUIRED is on.
 */
export async function sessionHasAppAccess(session: Session): Promise<boolean> {
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return false;
  }

  const db = getDb();
  const [user] = await db
    .select({ isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, effectiveHqUserId))
    .limit(1);
  if (user?.isPlatformMaintainer === 1) {
    return true;
  }

  const connection = await getAshedConnection(session.id);
  const hasMembership = await sessionHasActiveMembership(session);
  const isNative = await sessionHasNativeMembership(session);

  if (isNative) {
    if (!(await sessionPassesNativeInviteGate(effectiveHqUserId))) {
      return false;
    }
    return true;
  }

  if (hasMembership) {
    if (!(await sessionPassesAshedInviteGate(effectiveHqUserId))) {
      return false;
    }
    return true;
  }

  if (connection !== null) {
    if (!(await sessionPassesAshedInviteGate(effectiveHqUserId))) {
      return false;
    }
    return true;
  }

  return false;
}

export {
  emailHasAshedConnectAccess,
  emailHasAshedConnectAccess as emailHasInvitedAccess,
  isAshedInviteRequired,
  isAshedInviteRequired as isProductionInviteGateEnabled,
  isNativeInviteRequired,
};
