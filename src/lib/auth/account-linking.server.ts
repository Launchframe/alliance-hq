import "server-only";

import type { Account } from "next-auth";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import {
  canUnlinkOAuthProvider,
  countSignInMethods,
  linkedProvidersFromOAuthAccounts,
  mayAutoLinkOAuthAtSignIn,
  normalizeOAuthProviderEmail,
  type LinkedOAuthProvider,
  type OAuthAutoLinkDecision,
  type OAuthProviderAccountSnapshot,
  type SignInMethodSnapshot,
} from "@/lib/auth/account-linking.shared";
import { canRemovePasskeys } from "@/lib/auth/sign-in-method-linked.shared";
import { createHqAuthAdapter } from "@/lib/auth/adapter";
import {
  isPostgresUniqueViolation,
  readPostgresConstraintName,
} from "@/lib/auth/postgres-unique.shared";
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

function toOAuthProviderAccountSnapshot(
  row: Pick<
    typeof schema.hqAuthAccounts.$inferSelect,
    "provider" | "providerAccountId" | "providerEmail"
  >,
): OAuthProviderAccountSnapshot | null {
  if (!isOAuthLinkProvider(row.provider)) {
    return null;
  }
  return {
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    providerEmail: row.providerEmail,
  };
}

export async function loadOAuthProviderAccountsForUser(
  hqUserId: string,
): Promise<OAuthProviderAccountSnapshot[]> {
  const db = getDb();
  const rows = await db
    .select({
      provider: schema.hqAuthAccounts.provider,
      providerAccountId: schema.hqAuthAccounts.providerAccountId,
      providerEmail: schema.hqAuthAccounts.providerEmail,
    })
    .from(schema.hqAuthAccounts)
    .where(eq(schema.hqAuthAccounts.hqUserId, hqUserId));

  return rows
    .map(toOAuthProviderAccountSnapshot)
    .filter((row): row is OAuthProviderAccountSnapshot => row !== null);
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

  const oauthAccounts = await loadOAuthProviderAccountsForUser(hqUserId);

  const passkeys = await db
    .select({ credentialID: schema.hqAuthenticators.credentialID })
    .from(schema.hqAuthenticators)
    .where(eq(schema.hqAuthenticators.hqUserId, hqUserId));

  return {
    email: user.email,
    hasPassword: await hqUserHasPassword(hqUserId),
    passkeyCount: passkeys.length,
    oauthAccounts,
    linkedProviders: linkedProvidersFromOAuthAccounts(oauthAccounts),
  };
}

export async function findHqUserIdForOAuthAccount(input: {
  provider: LinkedOAuthProvider;
  providerAccountId: string;
}): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ hqUserId: schema.hqAuthAccounts.hqUserId })
    .from(schema.hqAuthAccounts)
    .where(
      and(
        eq(schema.hqAuthAccounts.provider, input.provider),
        eq(schema.hqAuthAccounts.providerAccountId, input.providerAccountId),
      ),
    )
    .limit(1);
  return row?.hqUserId ?? null;
}

export async function getOAuthProviderAccountForUser(input: {
  hqUserId: string;
  provider: LinkedOAuthProvider;
}): Promise<OAuthProviderAccountSnapshot | null> {
  const db = getDb();
  const [row] = await db
    .select({
      provider: schema.hqAuthAccounts.provider,
      providerAccountId: schema.hqAuthAccounts.providerAccountId,
      providerEmail: schema.hqAuthAccounts.providerEmail,
    })
    .from(schema.hqAuthAccounts)
    .where(
      and(
        eq(schema.hqAuthAccounts.hqUserId, input.hqUserId),
        eq(schema.hqAuthAccounts.provider, input.provider),
      ),
    )
    .limit(1);

  return row ? toOAuthProviderAccountSnapshot(row) : null;
}

export async function hqUserHasOAuthProvider(
  hqUserId: string,
  provider: LinkedOAuthProvider,
): Promise<boolean> {
  const account = await getOAuthProviderAccountForUser({ hqUserId, provider });
  return account !== null;
}

export async function updateOAuthProviderEmail(input: {
  provider: LinkedOAuthProvider;
  providerAccountId: string;
  providerEmail: string | null;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.hqAuthAccounts)
    .set({ providerEmail: input.providerEmail })
    .where(
      and(
        eq(schema.hqAuthAccounts.provider, input.provider),
        eq(schema.hqAuthAccounts.providerAccountId, input.providerAccountId),
      ),
    );
}

export async function linkOAuthAccountToHqUser(input: {
  hqUserId: string;
  account: Pick<Account, "type" | "provider" | "providerAccountId">;
  providerEmail?: string | null;
}): Promise<void> {
  const provider = input.account.provider;
  if (!isOAuthLinkProvider(provider)) {
    throw new Error("Unsupported OAuth provider.");
  }

  const providerEmail = normalizeOAuthProviderEmail(input.providerEmail);
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
    providerEmail,
  });
}

export type SignedInOAuthLinkResult =
  | { ok: true; action: "linked" | "refreshed" }
  | {
      ok: false;
      code: "provider_account_on_other_user" | "provider_type_already_linked";
    };

const HQ_AUTH_PROVIDER_ACCOUNT_UNIQUE = "hq_auth_accounts_provider_account_unique";
const HQ_AUTH_HQ_USER_PROVIDER_UNIQUE = "hq_auth_accounts_hq_user_provider_unique";

async function resolveSignedInOAuthLinkUniqueViolation(input: {
  error: unknown;
  hqUserId: string;
  provider: LinkedOAuthProvider;
  providerAccountId: string;
  providerEmail: string | null;
}): Promise<SignedInOAuthLinkResult | null> {
  if (!isPostgresUniqueViolation(input.error)) {
    return null;
  }

  const constraint = readPostgresConstraintName(input.error);
  if (constraint === HQ_AUTH_HQ_USER_PROVIDER_UNIQUE) {
    return { ok: false, code: "provider_type_already_linked" };
  }
  if (
    constraint !== null &&
    constraint !== HQ_AUTH_PROVIDER_ACCOUNT_UNIQUE
  ) {
    return null;
  }

  const existingOwnerId = await findHqUserIdForOAuthAccount({
    provider: input.provider,
    providerAccountId: input.providerAccountId,
  });
  if (!existingOwnerId) {
    return null;
  }
  if (existingOwnerId !== input.hqUserId) {
    return { ok: false, code: "provider_account_on_other_user" };
  }

  await updateOAuthProviderEmail({
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    providerEmail: input.providerEmail,
  });
  return { ok: true, action: "refreshed" };
}

/**
 * Attach an OAuth provider account to the signed-in HQ user by provider user ID.
 * Does not compare provider email to hq_users.email.
 */
export async function linkOAuthAccountForSignedInUser(input: {
  hqUserId: string;
  account: Pick<Account, "type" | "provider" | "providerAccountId">;
  providerEmail?: string | null;
}): Promise<SignedInOAuthLinkResult> {
  const provider = input.account.provider;
  if (!isOAuthLinkProvider(provider)) {
    throw new Error("Unsupported OAuth provider.");
  }

  const providerAccountId = input.account.providerAccountId;
  const providerEmail = normalizeOAuthProviderEmail(input.providerEmail);

  const existingOwnerId = await findHqUserIdForOAuthAccount({
    provider,
    providerAccountId,
  });
  if (existingOwnerId && existingOwnerId !== input.hqUserId) {
    return { ok: false, code: "provider_account_on_other_user" };
  }

  const existingForUser = await getOAuthProviderAccountForUser({
    hqUserId: input.hqUserId,
    provider,
  });

  if (existingForUser) {
    if (existingForUser.providerAccountId === providerAccountId) {
      await updateOAuthProviderEmail({
        provider,
        providerAccountId,
        providerEmail,
      });
      return { ok: true, action: "refreshed" };
    }
    return { ok: false, code: "provider_type_already_linked" };
  }

  try {
    await linkOAuthAccountToHqUser({
      hqUserId: input.hqUserId,
      account: input.account,
      providerEmail,
    });
    return { ok: true, action: "linked" };
  } catch (error) {
    const raced = await resolveSignedInOAuthLinkUniqueViolation({
      error,
      hqUserId: input.hqUserId,
      provider,
      providerAccountId,
      providerEmail,
    });
    if (raced) {
      return raced;
    }
    throw error;
  }
}

export async function resolveOAuthColdSignInDecision(input: {
  provider: LinkedOAuthProvider;
  oauthEmail: string;
  profile: Record<string, unknown> | undefined;
}): Promise<OAuthAutoLinkDecision> {
  const normalized = normalizeAshedEmail(input.oauthEmail);
  if (!normalized) {
    return "block_sign_in_with_hq_email";
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
    return { allowed: false, decision: "block_sign_in_with_hq_email" };
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
    providerEmail: input.oauthEmail,
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

export async function unlinkPasskeysForUser(
  hqUserId: string,
): Promise<{ ok: true } | { ok: false; code: "none" | "last_method" }> {
  const snapshot = await loadSignInMethodSnapshot(hqUserId);
  if (!snapshot || snapshot.passkeyCount === 0) {
    return { ok: false, code: "none" };
  }

  if (!canRemovePasskeys(snapshot)) {
    return { ok: false, code: "last_method" };
  }

  const db = getDb();
  await db
    .delete(schema.hqAuthenticators)
    .where(eq(schema.hqAuthenticators.hqUserId, hqUserId));

  return { ok: true };
}
