import "server-only";

import type { Account } from "next-auth";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import {
  canUnlinkOAuthProvider,
  countSignInMethods,
  mayAutoLinkOAuthAtSignIn,
  type LinkedOAuthProvider,
  type OAuthAutoLinkDecision,
  type SignInMethodSnapshot,
} from "@/lib/auth/account-linking.shared";
import { createHqAuthAdapter } from "@/lib/auth/adapter";
import { hqUserHasPassword } from "@/lib/auth/password.server";
import { getDb, schema } from "@/lib/db";

function isOAuthLinkProvider(
  provider: string | undefined,
): provider is LinkedOAuthProvider {
  return provider === "google" || provider === "discord";
}

function readOAuthEmailVerified(
  provider: LinkedOAuthProvider,
  profile: Record<string, unknown> | undefined,
): boolean {
  if (provider === "google") {
    return profile?.email_verified === true;
  }
  return false;
}

export async function loadSignInMethodSnapshot(
  hqUserId: string,
): Promise<SignInMethodSnapshot | null> {
  const db = getDb();
  const [user] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  if (!user?.email) {
    return null;
  }

  const oauthRows = await db
    .select({ provider: schema.hqAuthAccounts.provider })
    .from(schema.hqAuthAccounts)
    .where(eq(schema.hqAuthAccounts.hqUserId, hqUserId));

  const passkeys = await db
    .select({ credentialID: schema.hqAuthenticators.credentialID })
    .from(schema.hqAuthenticators)
    .where(eq(schema.hqAuthenticators.hqUserId, hqUserId));

  const linkedProviders = oauthRows
    .map((row) => row.provider)
    .filter(isOAuthLinkProvider);

  return {
    email: user.email,
    hasPassword: await hqUserHasPassword(hqUserId),
    passkeyCount: passkeys.length,
    linkedProviders,
  };
}

export async function hqUserHasOAuthProvider(
  hqUserId: string,
  provider: LinkedOAuthProvider,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.hqAuthAccounts.id })
    .from(schema.hqAuthAccounts)
    .where(
      and(
        eq(schema.hqAuthAccounts.hqUserId, hqUserId),
        eq(schema.hqAuthAccounts.provider, provider),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function linkOAuthAccountToHqUser(input: {
  hqUserId: string;
  account: Pick<Account, "type" | "provider" | "providerAccountId">;
}): Promise<void> {
  const adapter = createHqAuthAdapter();
  if (!adapter.linkAccount) {
    throw new Error("Auth adapter does not support linkAccount.");
  }
  await adapter.linkAccount({
    id: nanoid(16),
    userId: input.hqUserId,
    type: "oauth",
    provider: input.account.provider,
    providerAccountId: input.account.providerAccountId,
  });
}

export async function resolveOAuthColdSignInDecision(input: {
  provider: LinkedOAuthProvider;
  oauthEmail: string;
  profile: Record<string, unknown> | undefined;
}): Promise<OAuthAutoLinkDecision> {
  const normalized = normalizeAshedEmail(input.oauthEmail);
  if (!normalized) {
    return "block_email_mismatch";
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.hqUsers.id, email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (!existing) {
    return "allow";
  }

  const hasExistingOAuthLink = await hqUserHasOAuthProvider(
    existing.id,
    input.provider,
  );

  return mayAutoLinkOAuthAtSignIn({
    provider: input.provider,
    oauthEmail: input.oauthEmail,
    emailVerified: readOAuthEmailVerified(input.provider, input.profile),
    hqUserEmail: existing.email,
    hasExistingOAuthLink,
  });
}

export async function tryAutoLinkOAuthAtSignIn(input: {
  provider: LinkedOAuthProvider;
  oauthEmail: string;
  profile: Record<string, unknown> | undefined;
  account: Pick<Account, "type" | "provider" | "providerAccountId">;
}): Promise<{ allowed: boolean; decision: OAuthAutoLinkDecision }> {
  const decision = await resolveOAuthColdSignInDecision({
    provider: input.provider,
    oauthEmail: input.oauthEmail,
    profile: input.profile,
  });

  if (decision === "allow") {
    return { allowed: true, decision };
  }

  if (decision !== "auto_link") {
    return { allowed: false, decision };
  }

  const normalized = normalizeAshedEmail(input.oauthEmail);
  if (!normalized) {
    return { allowed: false, decision: "block_email_mismatch" };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.email, normalized))
    .limit(1);

  if (!existing) {
    return { allowed: true, decision: "allow" };
  }

  await linkOAuthAccountToHqUser({
    hqUserId: existing.id,
    account: input.account,
  });

  return { allowed: true, decision: "auto_link" };
}

export async function unlinkOAuthProviderForUser(input: {
  hqUserId: string;
  provider: LinkedOAuthProvider;
}): Promise<{ ok: true } | { ok: false; code: "not_linked" | "last_method" }> {
  const snapshot = await loadSignInMethodSnapshot(input.hqUserId);
  if (!snapshot) {
    return { ok: false, code: "not_linked" };
  }

  if (!canUnlinkOAuthProvider(snapshot, input.provider)) {
    return { ok: false, code: countSignInMethods(snapshot) <= 1 ? "last_method" : "not_linked" };
  }

  const db = getDb();
  const [account] = await db
    .select({
      providerAccountId: schema.hqAuthAccounts.providerAccountId,
    })
    .from(schema.hqAuthAccounts)
    .where(
      and(
        eq(schema.hqAuthAccounts.hqUserId, input.hqUserId),
        eq(schema.hqAuthAccounts.provider, input.provider),
      ),
    )
    .limit(1);

  if (!account) {
    return { ok: false, code: "not_linked" };
  }

  const adapter = createHqAuthAdapter();
  if (!adapter.unlinkAccount) {
    throw new Error("Auth adapter does not support unlinkAccount.");
  }

  await adapter.unlinkAccount({
    provider: input.provider,
    providerAccountId: account.providerAccountId,
  });

  return { ok: true };
}
