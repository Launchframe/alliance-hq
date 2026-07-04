import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const CONNECT_RETURN_STORAGE_KEY = "alliance-hq-connect-return";

export const DEFAULT_CONNECT_RETURN_FALLBACK = "/members";

/** Build `/connect` href with optional sanitized `next` query param. */
export function buildConnectHref(returnPath: string | null | undefined): string {
  const safe = sanitizeInternalRedirectPath(returnPath);
  if (!safe || safe === "/connect") {
    return "/connect";
  }
  return `/connect?next=${encodeURIComponent(safe)}`;
}

export function resolveConnectReturnPath(options: {
  queryNext?: string | null;
  stashedPath?: string | null;
  fallback?: string;
}): string {
  const fallback =
    sanitizeInternalRedirectPath(options.fallback) ??
    DEFAULT_CONNECT_RETURN_FALLBACK;

  const fromQuery = sanitizeInternalRedirectPath(options.queryNext);
  if (fromQuery && fromQuery !== "/connect") {
    return fromQuery;
  }

  const fromStash = sanitizeInternalRedirectPath(options.stashedPath);
  if (fromStash && fromStash !== "/connect") {
    return fromStash;
  }

  return fallback;
}

export function readStashedConnectReturnPath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return sanitizeInternalRedirectPath(
    window.sessionStorage.getItem(CONNECT_RETURN_STORAGE_KEY),
  );
}

/** Belt-and-suspenders stash when navigating to connect without a `next` param. */
export function stashConnectReturnPath(path: string | null | undefined): void {
  if (typeof window === "undefined") {
    return;
  }
  const safe = sanitizeInternalRedirectPath(path);
  if (!safe || safe === "/connect") {
    return;
  }
  window.sessionStorage.setItem(CONNECT_RETURN_STORAGE_KEY, safe);
}

export function clearStashedConnectReturnPath(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(CONNECT_RETURN_STORAGE_KEY);
}
