import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getAshedCredentialRecord } from "@/lib/session";

/** Ashed-sourced memberships apply only while this browser session holds the matching credential. */
export async function sessionHoldsAshedIdentityForHqUser(
  sessionId: string,
  hqUserId: string,
): Promise<boolean> {
  const cred = await getAshedCredentialRecord(sessionId);
  if (!cred?.ashedUserId) {
    return false;
  }

  const db = getDb();
  const [user] = await db
    .select({ ashedUserId: schema.hqUsers.ashedUserId })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  return user?.ashedUserId === cred.ashedUserId;
}

/** True when this session stores another user's Ashed credential (shared-browser isolation). */
export async function sessionHasConflictingAshedCredentialForHqUser(
  sessionId: string,
  hqUserId: string,
): Promise<boolean> {
  const cred = await getAshedCredentialRecord(sessionId);
  if (!cred?.ashedUserId) {
    return false;
  }

  const db = getDb();
  const [user] = await db
    .select({ ashedUserId: schema.hqUsers.ashedUserId })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  if (!user?.ashedUserId) {
    return true;
  }

  return user.ashedUserId !== cred.ashedUserId;
}

export function ashedSourcedMembershipIsActiveForSession(
  source: string,
  sessionHoldsAshedIdentity: boolean,
): boolean {
  if (source !== "ashed") {
    return true;
  }
  return sessionHoldsAshedIdentity;
}
