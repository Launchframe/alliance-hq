import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { signingInUserMatchesConnectedSessionOwner } from "@/lib/auth/session-connect-identity";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import {
  clearAshedConnection,
  getAshedCredentialRecord,
  getOrCreateSession,
  loadSession,
  requirePageSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";

/**
 * Picks the HQ user id for this browser session after magic-link auth.
 * Preserves a connect/rebind binding when the session already holds the Ashed
 * credential, even if NextAuth still references a superseded magic-link stub.
 */
export async function resolveBridgeHqUserId(input: {
  hqUserId: string;
}): Promise<string> {
  const session = await getOrCreateSession();
  const freshSession = (await loadSession(session.id)) ?? session;

  if (
    freshSession.hqUserId &&
    (await sessionHoldsAshedIdentityForHqUser(
      freshSession.id,
      freshSession.hqUserId,
    ))
  ) {
    if (
      await signingInUserMatchesConnectedSessionOwner({
        sessionId: freshSession.id,
        signingInHqUserId: input.hqUserId,
        sessionOwnerHqUserId: freshSession.hqUserId,
      })
    ) {
      return freshSession.hqUserId;
    }
  }

  if (
    await sessionHoldsAshedIdentityForHqUser(freshSession.id, input.hqUserId)
  ) {
    return (
      (await resolveEffectiveHqUserIdForSession(
        freshSession.id,
        input.hqUserId,
      )) ?? input.hqUserId
    );
  }

  if (await getAshedCredentialRecord(freshSession.id)) {
    await clearAshedConnection(freshSession.id);
  }

  return input.hqUserId;
}

export async function bridgeAuthUserToBrowserSession(input: {
  hqUserId: string;
  email: string;
  displayName?: string | null;
  markEmailVerified?: boolean;
}): Promise<string> {
  const session = await getOrCreateSession();
  const db = getDb();
  const now = new Date();
  const hqUserId = await resolveBridgeHqUserId({ hqUserId: input.hqUserId });
  const userLabel =
    input.displayName?.trim() || input.email.trim() || session.userLabel;

  if (input.markEmailVerified !== false) {
    await db
      .update(schema.hqUsers)
      .set({
        emailVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, hqUserId));
  }

  await db
    .update(schema.sessions)
    .set({
      hqUserId,
      userLabel: userLabel ?? null,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, session.id));

  return session.id;
}

/**
 * Page-render-safe bridge. Server Components may not set cookies, so this
 * ensures a browser session exists via the bootstrap Route Handler
 * (`requirePageSession` redirects there when the session cookie has no DB row —
 * e.g. a stale cookie after a DB reset) before delegating to the bridge. The
 * delegated `getOrCreateSession` then reads the existing row instead of trying
 * to create one and call `cookies().set()` mid-render.
 */
export async function bridgeAuthUserToPageSession(
  input: {
    hqUserId: string;
    email: string;
    displayName?: string | null;
    markEmailVerified?: boolean;
  },
  callbackPath = "/",
): Promise<string> {
  await requirePageSession(callbackPath);
  return bridgeAuthUserToBrowserSession(input);
}
