import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";

export class AshedConnectAuthMismatchError extends Error {
  readonly code = "ashed_connect_auth_mismatch" as const;

  constructor() {
    super(
      "This Ashed account belongs to a different HQ sign-in. Sign out, sign in with the matching account, then connect Ashed again.",
    );
    this.name = "AshedConnectAuthMismatchError";
  }
}

/** Magic-link / email-code only — not Google, Discord, passkey, or password sign-in. */
const ASHED_CONNECT_MERGE_FRIENDLY_AUTH_PROVIDERS = new Set([
  "resend",
  "email-code",
]);

/**
 * Invite or magic-link stubs (no external SSO) may merge into a canonical Ashed
 * row after the connect route verifies the connection string.
 */
async function authHqUserMayMergeViaVerifiedAshedConnect(
  authHqUserId: string,
): Promise<boolean> {
  const db = getDb();
  const accounts = await db
    .select({ provider: schema.hqAuthAccounts.provider })
    .from(schema.hqAuthAccounts)
    .where(eq(schema.hqAuthAccounts.hqUserId, authHqUserId));

  if (accounts.length === 0) {
    return true;
  }

  return accounts.every((row) =>
    ASHED_CONNECT_MERGE_FRIENDLY_AUTH_PROVIDERS.has(row.provider),
  );
}

/**
 * Blocks connecting Ashed credentials that belong to another HQ user while a
 * different account (e.g. Google SSO) is signed in on this browser session.
 */
export async function assertAuthMayMergeIntoCanonicalHqUser(input: {
  authHqUserId: string;
  canonicalHqUserId: string;
  ashedEmail: string;
  ashedUserId?: string | null;
}): Promise<void> {
  if (input.authHqUserId === input.canonicalHqUserId) {
    return;
  }

  if (
    await hqUsersShareEmail(input.authHqUserId, input.canonicalHqUserId)
  ) {
    return;
  }

  const db = getDb();
  const [authRow] = await db
    .select({
      email: schema.hqUsers.email,
      ashedUserId: schema.hqUsers.ashedUserId,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, input.authHqUserId))
    .limit(1);

  if (!authRow) {
    throw new AshedConnectAuthMismatchError();
  }

  const connectingAshedId = input.ashedUserId?.trim() || null;
  if (
    authRow.ashedUserId &&
    connectingAshedId &&
    authRow.ashedUserId !== connectingAshedId
  ) {
    throw new AshedConnectAuthMismatchError();
  }

  const authEmail = authRow.email ? normalizeAshedEmail(authRow.email) : "";
  const ashedEmail = normalizeAshedEmail(input.ashedEmail);
  if (authEmail && ashedEmail && authEmail === ashedEmail) {
    return;
  }

  if (
    !authRow.ashedUserId &&
    (await authHqUserMayMergeViaVerifiedAshedConnect(input.authHqUserId))
  ) {
    const [canonicalRow] = await db
      .select({
        email: schema.hqUsers.email,
        ashedUserId: schema.hqUsers.ashedUserId,
      })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, input.canonicalHqUserId))
      .limit(1);

    const canonicalEmail = canonicalRow?.email
      ? normalizeAshedEmail(canonicalRow.email)
      : "";

    // HQ row already registered with the Ashed account email — only the same
    // person may merge another session (invite stubs keep a different email).
    if (
      canonicalRow?.ashedUserId &&
      canonicalEmail &&
      canonicalEmail === ashedEmail &&
      authEmail &&
      authEmail !== ashedEmail
    ) {
      throw new AshedConnectAuthMismatchError();
    }

    return;
  }

  throw new AshedConnectAuthMismatchError();
}

/** Pre-connect guard — fails before storing Ashed credentials on the session. */
export async function assertAshedConnectAuthBinding(input: {
  authHqUserId?: string | null;
  ashedUserId?: string | null;
  ashedEmail: string;
}): Promise<void> {
  if (!input.authHqUserId) {
    return;
  }

  const ashedEmail = normalizeAshedEmail(input.ashedEmail);
  if (!ashedEmail) {
    throw new Error("Ashed email is required.");
  }

  const db = getDb();
  const ashedUserId = input.ashedUserId?.trim() || null;
  let canonicalHqUserId: string | null = null;

  if (ashedUserId) {
    const [byAshedId] = await db
      .select({ id: schema.hqUsers.id })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.ashedUserId, ashedUserId))
      .limit(1);
    canonicalHqUserId = byAshedId?.id ?? null;
  }

  if (!canonicalHqUserId) {
    const [byEmail] = await db
      .select({ id: schema.hqUsers.id })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.email, ashedEmail))
      .limit(1);
    canonicalHqUserId = byEmail?.id ?? null;
  }

  if (!canonicalHqUserId) {
    return;
  }

  await assertAuthMayMergeIntoCanonicalHqUser({
    authHqUserId: input.authHqUserId,
    canonicalHqUserId,
    ashedEmail,
    ashedUserId,
  });
}

export async function hqUsersShareEmail(
  leftHqUserId: string,
  rightHqUserId: string,
): Promise<boolean> {
  if (leftHqUserId === rightHqUserId) {
    return true;
  }

  const db = getDb();
  const [left, right] = await Promise.all([
    db
      .select({ email: schema.hqUsers.email })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, leftHqUserId))
      .limit(1),
    db
      .select({ email: schema.hqUsers.email })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, rightHqUserId))
      .limit(1),
  ]);

  const leftEmail = left[0]?.email ? normalizeAshedEmail(left[0].email) : "";
  const rightEmail = right[0]?.email ? normalizeAshedEmail(right[0].email) : "";
  return Boolean(leftEmail && rightEmail && leftEmail === rightEmail);
}

/** Magic-link stub superseded by canonical Ashed identity on this browser session. */
export async function sessionMergedAuthStubHqUserId(
  sessionId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ metadata: schema.auditLog.metadata })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.sessionId, sessionId),
        eq(schema.auditLog.action, "ashed.rebind"),
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(1);

  const metadata = row?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const mergedFrom = (metadata as { mergedFromHqUserId?: unknown })
    .mergedFromHqUserId;
  return typeof mergedFrom === "string" && mergedFrom.trim().length > 0
    ? mergedFrom.trim()
    : null;
}

/**
 * True when NextAuth / magic-link sign-in is the same person as the session's
 * post-connect canonical HQ user (not a different user hijacking the browser).
 */
export async function signingInUserMatchesConnectedSessionOwner(input: {
  sessionId: string;
  signingInHqUserId: string;
  sessionOwnerHqUserId: string;
}): Promise<boolean> {
  if (input.signingInHqUserId === input.sessionOwnerHqUserId) {
    return true;
  }

  if (
    await sessionHoldsAshedIdentityForHqUser(
      input.sessionId,
      input.signingInHqUserId,
    )
  ) {
    return true;
  }

  if (
    await hqUsersShareEmail(
      input.signingInHqUserId,
      input.sessionOwnerHqUserId,
    )
  ) {
    return true;
  }

  const mergedStub = await sessionMergedAuthStubHqUserId(input.sessionId);
  return mergedStub === input.signingInHqUserId;
}
