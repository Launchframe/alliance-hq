export const DEFAULT_INVITE_ACCEPT_REDIRECT = "/connect?welcome=1";

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
