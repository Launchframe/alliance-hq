/** User dismissed Ashed connect nudges in the app shell (banner, header, profile menu). */
export const ASHED_SHELL_CONNECT_DISMISSED_KEY =
  "alliance-hq-ashed-shell-connect-dismissed";

/** @deprecated Migrated to {@link ASHED_SHELL_CONNECT_DISMISSED_KEY}. */
const LEGACY_CONNECT_BANNER_DISMISSED_KEY =
  "alliance-hq-connect-ashed-banner-dismissed";

const ASHED_SHELL_CONNECT_DISMISSED_EVENT =
  "alliance-hq-ashed-shell-connect-dismissed-change";

export function readAshedShellConnectDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return (
      window.localStorage.getItem(ASHED_SHELL_CONNECT_DISMISSED_KEY) === "1" ||
      window.localStorage.getItem(LEGACY_CONNECT_BANNER_DISMISSED_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function markAshedShellConnectDismissed(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ASHED_SHELL_CONNECT_DISMISSED_KEY, "1");
    window.localStorage.removeItem(LEGACY_CONNECT_BANNER_DISMISSED_KEY);
    window.dispatchEvent(new Event(ASHED_SHELL_CONNECT_DISMISSED_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function subscribeAshedShellConnectDismissed(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(ASHED_SHELL_CONNECT_DISMISSED_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(ASHED_SHELL_CONNECT_DISMISSED_EVENT, handler);
  };
}

/** Connect nudges in the shell — hidden when connected, embeds off, or user dismissed. */
export function shouldShowAshedConnectNudge(input: {
  hasAppAccess: boolean;
  isConnected: boolean;
  canUseAshedEmbeds: boolean;
  isAshedConnectAllowed: boolean;
  dismissed: boolean;
}): boolean {
  return (
    input.hasAppAccess &&
    !input.isConnected &&
    input.canUseAshedEmbeds &&
    input.isAshedConnectAllowed &&
    !input.dismissed
  );
}

/** Live Ashed sync actions — only when a session credential exists. */
export function canRefreshRosterFromAshed(input: {
  operatingMode: "ashed" | "native";
  isAshedConnected: boolean;
}): boolean {
  return input.operatingMode === "ashed" && input.isAshedConnected;
}
