import { normalizeAshedEmail } from "@/lib/alliance/accessible";

export type OAuthLinkProvider = "google" | "discord";

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
  | "block_email_mismatch"
  | "block_unverified"
  | "block_discord_cold_signin";

/**
 * Whether OAuth may attach to an existing HQ user during cold sign-in (no session).
 * Account-page linking while signed in is handled separately in the signIn callback.
 */
export function mayAutoLinkOAuthAtSignIn(
  input: MayAutoLinkOAuthInput,
): OAuthAutoLinkDecision {
  if (input.hasExistingOAuthLink) {
    return "allow";
  }

  if (input.provider === "discord") {
    return "block_discord_cold_signin";
  }

  if (!input.emailVerified) {
    return "block_unverified";
  }

  const oauthEmail = normalizeAshedEmail(input.oauthEmail);
  const hqEmail = normalizeAshedEmail(input.hqUserEmail);
  if (!oauthEmail || !hqEmail || oauthEmail !== hqEmail) {
    return "block_email_mismatch";
  }

  return "auto_link";
}

export type LinkedOAuthProvider = OAuthLinkProvider;

export type SignInMethodSnapshot = {
  email: string;
  hasPassword: boolean;
  passkeyCount: number;
  linkedProviders: LinkedOAuthProvider[];
};

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
  count += methods.linkedProviders.length;
  return count;
}

export function canUnlinkOAuthProvider(
  methods: SignInMethodSnapshot,
  provider: LinkedOAuthProvider,
): boolean {
  if (!methods.linkedProviders.includes(provider)) {
    return false;
  }
  const withoutProvider: SignInMethodSnapshot = {
    ...methods,
    linkedProviders: methods.linkedProviders.filter((row) => row !== provider),
  };
  return countSignInMethods(withoutProvider) >= 1;
}
