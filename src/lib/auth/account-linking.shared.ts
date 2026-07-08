import { normalizeAshedEmail } from "@/lib/alliance/accessible";

export type OAuthLinkProvider = "google" | "discord";

export type OAuthProviderAccountSnapshot = {
  provider: OAuthLinkProvider;
  providerAccountId: string;
  providerEmail: string | null;
};

export type MayAutoLinkOAuthInput = {
  provider: OAuthLinkProvider;
  oauthEmail: string;
  emailVerified: boolean;
  hqUserEmail: string;
  hasExistingOAuthLink: boolean;
};

export type OAuthAutoLinkDecision =
  | "allow"
  | "auto_link"
  | "block_sign_in_with_hq_email"
  | "block_unverified"
  | "block_discord_no_email";

/**
 * Whether OAuth may attach to an existing HQ user during cold sign-in (no session).
 * Signed-in linking uses provider account IDs only — see the Auth.js signIn callback.
 */
export function mayAutoLinkOAuthAtSignIn(
  input: MayAutoLinkOAuthInput,
): OAuthAutoLinkDecision {
  if (input.hasExistingOAuthLink) {
    return "allow";
  }

  if (input.provider === "discord") {
    const oauthEmail = normalizeAshedEmail(input.oauthEmail);
    const hqEmail = normalizeAshedEmail(input.hqUserEmail);
    if (!oauthEmail) {
      return "block_discord_no_email";
    }
    if (!hqEmail || oauthEmail !== hqEmail) {
      return "block_sign_in_with_hq_email";
    }
    return "auto_link";
  }

  if (!input.emailVerified) {
    return "block_unverified";
  }

  const oauthEmail = normalizeAshedEmail(input.oauthEmail);
  const hqEmail = normalizeAshedEmail(input.hqUserEmail);
  if (!oauthEmail || !hqEmail || oauthEmail !== hqEmail) {
    return "block_sign_in_with_hq_email";
  }

  return "auto_link";
}

export type LinkedOAuthProvider = OAuthLinkProvider;

export type SignInMethodSnapshot = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
  oauthAccounts: OAuthProviderAccountSnapshot[];
};

export function linkedProvidersFromOAuthAccounts(
  accounts: OAuthProviderAccountSnapshot[],
): LinkedOAuthProvider[] {
  return accounts.map((row) => row.provider);
}

export function countSignInMethods(methods: SignInMethodSnapshot): number {
  let count = 0;
  if (methods.email.trim()) {
    count += 1;
  }
  if (methods.hasPassword) {
    count += 1;
  }
  if (methods.passkeyCount > 0) {
    count += 1;
  }
  count += methods.oauthAccounts.length;
  return count;
}

export function canUnlinkOAuthProvider(
  methods: SignInMethodSnapshot,
  provider: LinkedOAuthProvider,
): boolean {
  if (!methods.oauthAccounts.some((row) => row.provider === provider)) {
    return false;
  }
  const withoutProvider: SignInMethodSnapshot = {
    ...methods,
    oauthAccounts: methods.oauthAccounts.filter((row) => row.provider !== provider),
    linkedProviders: methods.linkedProviders.filter((row) => row !== provider),
  };
  return countSignInMethods(withoutProvider) >= 1;
}

/** Normalize provider email for storage; empty → null. */
export function normalizeOAuthProviderEmail(
  email: string | null | undefined,
): string | null {
  const normalized = normalizeAshedEmail(email ?? "");
  return normalized || null;
}
