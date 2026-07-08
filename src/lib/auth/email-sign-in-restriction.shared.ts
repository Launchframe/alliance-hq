import type {
  LinkedOAuthProvider,
  SignInMethodSnapshot,
} from "@/lib/auth/account-linking.shared";

export type EmailSignInRestriction =
  | { blocked: false }
  | {
      blocked: true;
      email: string;
      linkedProviders: LinkedOAuthProvider[];
    };

/**
 * OAuth-only HQ accounts must sign in with their linked provider(s).
 * Email codes and magic links stay available when password or passkey is also set.
 */
export function resolveEmailSignInRestriction(
  snapshot: SignInMethodSnapshot,
): EmailSignInRestriction {
  if (snapshot.linkedProviders.length === 0) {
    return { blocked: false };
  }
  if (snapshot.hasPassword || snapshot.passkeyCount > 0) {
    return { blocked: false };
  }

  return {
    blocked: true,
    email: snapshot.email,
    linkedProviders: snapshot.linkedProviders,
  };
}

export function formatLinkedOAuthProviderList(
  providers: LinkedOAuthProvider[],
  labels: { google: string; discord: string },
): string {
  const names = providers.map((provider) =>
    provider === "google" ? labels.google : labels.discord,
  );
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} or ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}

export const OAUTH_SIGN_IN_REQUIRED_ERROR = "OAuthSignInRequired";

export function buildOAuthSignInRequiredAuthPath(
  restriction: Extract<EmailSignInRestriction, { blocked: true }>,
): string {
  const params = new URLSearchParams({
    error: OAUTH_SIGN_IN_REQUIRED_ERROR,
    email: restriction.email,
    providers: restriction.linkedProviders.join(","),
  });
  return `/auth?${params.toString()}`;
}

export function parseOAuthSignInRequiredSearchParams(input: {
  error?: string | null;
  email?: string | null;
  providers?: string | null;
}): Extract<EmailSignInRestriction, { blocked: true }> | null {
  if (input.error?.trim() !== OAUTH_SIGN_IN_REQUIRED_ERROR) {
    return null;
  }

  const email = input.email?.trim();
  if (!email) {
    return null;
  }

  const linkedProviders = (input.providers?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(
      (value): value is LinkedOAuthProvider =>
        value === "google" || value === "discord",
    );

  return {
    blocked: true,
    email,
    linkedProviders:
      linkedProviders.length > 0 ? linkedProviders : (["google"] as const),
  };
}
