import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";

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
