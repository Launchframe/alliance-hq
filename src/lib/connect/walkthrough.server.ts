import "server-only";

import { eq } from "drizzle-orm";

import { userHasActiveLinkedDevice } from "@/lib/credential-pairing/linked-devices";
import { getDb, schema } from "@/lib/db";
import {
  loadSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";

/** True when this HQ account has linked an Ashed identity before (even if disconnected now). */
export async function shouldSkipConnectWalkthrough(
  sessionId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return false;
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return false;
  }

  const db = getDb();
  const [user] = await db
    .select({ ashedUserId: schema.hqUsers.ashedUserId })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, effectiveHqUserId))
    .limit(1);

  return Boolean(user?.ashedUserId?.trim());
}

/** Returning Ashed reconnect with a phone already paired — skip optional link-phone step. */
export async function shouldSkipLinkPhoneStep(
  sessionId: string,
): Promise<boolean> {
  if (!(await shouldSkipConnectWalkthrough(sessionId))) {
    return false;
  }

  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return false;
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return false;
  }

  return userHasActiveLinkedDevice(effectiveHqUserId);
}
