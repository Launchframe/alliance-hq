import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { assertAuthMayMergeIntoCanonicalHqUser } from "@/lib/auth/session-connect-identity";
import { getDb, schema } from "@/lib/db";

export type ResolveCanonicalHqUserInput = {
  ashedUserId?: string | null;
  ashedEmail: string;
  displayName?: string | null;
  /** Magic-link HQ stub on the browser session before connect completes. */
  authHqUserId?: string | null;
};

export type ResolveCanonicalHqUserResult = {
  hqUserId: string;
  /** Provisional magic-link row superseded by canonical Ashed identity. */
  mergedFromHqUserId?: string;
};

async function mergedFromAuthHqUserId(input: {
  authHqUserId?: string | null;
  canonicalHqUserId: string;
  ashedEmail: string;
  ashedUserId: string | null;
}): Promise<string | undefined> {
  if (!input.authHqUserId || input.authHqUserId === input.canonicalHqUserId) {
    return undefined;
  }

  await assertAuthMayMergeIntoCanonicalHqUser({
    authHqUserId: input.authHqUserId,
    canonicalHqUserId: input.canonicalHqUserId,
    ashedEmail: input.ashedEmail,
    ashedUserId: input.ashedUserId,
  });

  return input.authHqUserId;
}

export async function resolveCanonicalHqUserForAshedConnect(
  input: ResolveCanonicalHqUserInput,
): Promise<ResolveCanonicalHqUserResult> {
  const email = normalizeAshedEmail(input.ashedEmail);
  if (!email) {
    throw new Error("Ashed email is required.");
  }

  const db = getDb();
  const now = new Date();
  const ashedUserId = input.ashedUserId?.trim() || null;

  if (ashedUserId) {
    const [byAshedId] = await db
      .select()
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.ashedUserId, ashedUserId))
      .limit(1);

    if (byAshedId) {
      await db
        .update(schema.hqUsers)
        .set({
          displayName: input.displayName?.trim() || byAshedId.displayName,
          updatedAt: now,
        })
        .where(eq(schema.hqUsers.id, byAshedId.id));

      return {
        hqUserId: byAshedId.id,
        mergedFromHqUserId: await mergedFromAuthHqUserId({
          authHqUserId: input.authHqUserId,
          canonicalHqUserId: byAshedId.id,
          ashedEmail: email,
          ashedUserId,
        }),
      };
    }
  }

  const [byEmail] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, email))
    .limit(1);

  if (byEmail) {
    if (ashedUserId && byEmail.ashedUserId && byEmail.ashedUserId !== ashedUserId) {
      throw new Error(
        "This Ashed account is already linked to a different HQ user.",
      );
    }

    await db
      .update(schema.hqUsers)
      .set({
        displayName: input.displayName?.trim() || byEmail.displayName,
        ...(ashedUserId ? { ashedUserId } : {}),
        updatedAt: now,
      })
      .where(eq(schema.hqUsers.id, byEmail.id));

    return {
      hqUserId: byEmail.id,
      mergedFromHqUserId: await mergedFromAuthHqUserId({
        authHqUserId: input.authHqUserId,
        canonicalHqUserId: byEmail.id,
        ashedEmail: email,
        ashedUserId,
      }),
    };
  }

  if (input.authHqUserId) {
    const [authRow] = await db
      .select()
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, input.authHqUserId))
      .limit(1);

    if (authRow && !authRow.ashedUserId) {
      await db
        .update(schema.hqUsers)
        .set({
          displayName: input.displayName?.trim() || authRow.displayName,
          ...(ashedUserId ? { ashedUserId } : {}),
          updatedAt: now,
        })
        .where(eq(schema.hqUsers.id, authRow.id));

      return { hqUserId: authRow.id };
    }

    if (authRow) {
      return {
        hqUserId: authRow.id,
      };
    }
  }

  const id = nanoid(16);
  await db.insert(schema.hqUsers).values({
    id,
    email,
    displayName: input.displayName?.trim() || null,
    ashedUserId,
    createdAt: now,
    updatedAt: now,
  });

  return {
    hqUserId: id,
    mergedFromHqUserId: input.authHqUserId ?? undefined,
  };
}
