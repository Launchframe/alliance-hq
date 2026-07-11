/** Relative HQ path used when a welcome funnel URL is unavailable on the client. */
export const DEFAULT_WELCOME_FALLBACK_PATH = "/dashboard";

/**
 * Returns a trimmed alliance tag for `/welcome?tag=…` URLs, or null when unset.
 * Intentionally does not synthesize a placeholder tag (e.g. "HQ"): the welcome
 * funnel resolves alliances by tag, so a junk tag would misroute recruits.
 */
export function allianceTagForWelcomeUrl(
  tag: string | null | undefined,
): string | null {
  const trimmed = tag?.trim() ?? "";
  return trimmed || null;
}

export function buildAbsoluteAppUrl(origin: string, path: string): string {
  const base = origin.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function buildWelcomeFallbackUrl(origin: string): string {
  return buildAbsoluteAppUrl(origin, DEFAULT_WELCOME_FALLBACK_PATH);
}

export function buildWelcomeJoinCodeUrl(
  origin: string,
  tag: string | null | undefined,
  code: string,
): string | null {
  const tagForUrl = allianceTagForWelcomeUrl(tag);
  if (!tagForUrl) {
    return null;
  }
  const base = origin.replace(/\/$/, "");
  const params = new URLSearchParams({
    tag: tagForUrl,
    code: code.trim(),
  });
  return `${base}/welcome?${params.toString()}`;
}

export function buildWelcomeInviteUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  const params = new URLSearchParams({
    invite: token.trim(),
  });
  return `${base}/welcome?${params.toString()}`;
}

/** Absolute legacy join path for outbound share copy when welcome URLs are unavailable. */
export function buildJoinCodeRedeemUrl(origin: string, code: string): string {
  const trimmed = code.trim();
  return buildAbsoluteAppUrl(
    origin,
    `/join?code=${encodeURIComponent(trimmed)}`,
  );
}

export function resolveWizardWelcomeUrl(input: {
  origin: string;
  welcomeUrl?: string | null;
  welcomeUrlRequiresAllianceTag?: boolean;
}): { welcomeUrl: string; welcomeUrlRequiresAllianceTag: boolean } {
  if (input.welcomeUrlRequiresAllianceTag) {
    return { welcomeUrl: "", welcomeUrlRequiresAllianceTag: true };
  }
  const trimmed = input.welcomeUrl?.trim();
  return {
    welcomeUrl: trimmed || buildWelcomeFallbackUrl(input.origin),
    welcomeUrlRequiresAllianceTag: false,
  };
}
