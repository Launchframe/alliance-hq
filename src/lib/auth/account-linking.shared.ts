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
  | "block_discord_no_email";

/**
 * When OAuth returns an email during a signed-in link, it must match the HQ
 * account. Missing OAuth email (common on Discord) is allowed — the session
 * proves which HQ row to attach.
 */
export function oauthEmailMatchesHqUserEmail(
  oauthEmail: string | null | undefined,
  hqUserEmail: string | null | undefined,
): boolean {
  const trimmed = oauthEmail?.trim();
  if (!trimmed) {
    return true;
  }
  const oauth = normalizeAshedEmail(trimmed);
  const hq = normalizeAshedEmail(hqUserEmail ?? "");
  if (!oauth || !hq) {
    return false;
  }
  return oauth === hq;
}

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
    const oauthEmail = normalizeAshedEmail(input.oauthEmail);
    const hqEmail = normalizeAshedEmail(input.hqUserEmail);
    if (!oauthEmail) {
      return "block_discord_no_email";
    }
    if (!hqEmail || oauthEmail !== hqEmail) {
      return "block_email_mismatch";
    }
    return "auto_link";
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
