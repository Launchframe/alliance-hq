export const DEFAULT_INVITE_ACCEPT_REDIRECT = "/onboard";
export const DEFAULT_POST_INVITE_APP_PATH = "/members";
export const DISCORD_POST_LINK_COMMANDER_DESTINATION = "/dashboard";

/** Allow only same-origin relative paths (blocks open redirects). */
export function sanitizeInternalRedirectPath(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) {
    return null;
  }

  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) {
    return null;
  }
  if (path.includes("\\") || path.includes("://")) {
    return null;
  }

  return path;
}

export function resolveInviteRedirect(options: {
  queryNext?: string | null;
  storedPath?: string | null;
  defaultPath?: string;
}): string {
  const defaultPath = options.defaultPath ?? DEFAULT_INVITE_ACCEPT_REDIRECT;
  return (
    sanitizeInternalRedirectPath(options.queryNext) ??
    sanitizeInternalRedirectPath(options.storedPath) ??
    defaultPath
  );
}

/** After invite accept, always show connect welcome before the invite destination. */
export function resolvePostInviteOnboardingRedirect(options: {
  queryNext?: string | null;
  storedPath?: string | null;
}): string {
  const destination =
    sanitizeInternalRedirectPath(options.queryNext) ??
    sanitizeInternalRedirectPath(options.storedPath) ??
    DEFAULT_POST_INVITE_APP_PATH;
  return `/onboard?next=${encodeURIComponent(destination)}`;
}

/** Commander onboarding after Discord `/link` (join code or existing membership). */
export function resolveDiscordPostLinkOnboardingRedirect(): string {
  return `/onboard?next=${encodeURIComponent(DISCORD_POST_LINK_COMMANDER_DESTINATION)}&source=discord`;
}
