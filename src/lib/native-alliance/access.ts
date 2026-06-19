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
import { getAshedConnection } from "@/lib/session";

import { getAllianceOperatingMode } from "./operating-mode";

export async function sessionHasActiveMembership(
  session: Session,
): Promise<boolean> {
  if (!session.hqUserId || !session.currentAllianceId) {
    return false;
  }

  const db = getDb();
  const [membership] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, session.hqUserId),
        eq(schema.allianceMemberships.allianceId, session.currentAllianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  return Boolean(membership);
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

async function sessionPassesNativeInviteGate(
  session: Session,
): Promise<boolean> {
  if (!isNativeInviteRequired()) {
    return true;
  }
  if (!session.hqUserId) {
    return false;
  }
  return hqUserHasAccessGrant(session.hqUserId);
}

async function sessionPassesAshedInviteGate(
  session: Session,
): Promise<boolean> {
  if (!isAshedInviteRequired()) {
    return true;
  }
  if (!session.hqUserId) {
    return false;
  }
  return hqUserHasAccessGrant(session.hqUserId);
}

/**
 * App shell access:
 * - Native alliance members always need an admin invite (accessGrantedAt).
 * - Ashed connection-key users need an invite only when HQ_ASHED_INVITE_REQUIRED is on.
 */
export async function sessionHasAppAccess(session: Session): Promise<boolean> {
  const connection = await getAshedConnection(session.id);
  const hasMembership = await sessionHasActiveMembership(session);
  const isNative = await sessionHasNativeMembership(session);

  if (isNative) {
    if (!(await sessionPassesNativeInviteGate(session))) {
      return false;
    }
    return true;
  }

  if (hasMembership) {
    if (!(await sessionPassesAshedInviteGate(session))) {
      return false;
    }
    return true;
  }

  if (connection !== null) {
    if (!(await sessionPassesAshedInviteGate(session))) {
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
