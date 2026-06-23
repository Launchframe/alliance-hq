import {
  readAshedShellConnectDismissed,
  shouldShowAshedConnectNudge,
} from "./ashed-shell-prompts.shared";

export const CONNECT_WALKTHROUGH_SEEN_KEY =
  "alliance-hq-connect-walkthrough-seen";

export function readConnectWalkthroughSeen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(CONNECT_WALKTHROUGH_SEEN_KEY) === "1";
}

export function markConnectWalkthroughSeen(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(CONNECT_WALKTHROUGH_SEEN_KEY, "1");
}

/** True after a successful Ashed connect on this browser (localStorage). */
export function readAshedConnectedOnThisDeviceBefore(): boolean {
  return readConnectWalkthroughSeen();
}

export function shouldShowShellConnectPrompt(input: {
  hasAppAccess: boolean;
  isConnected: boolean;
  canUseAshedEmbeds: boolean;
  isAshedConnectAllowed: boolean;
  ashedConnectedOnDeviceBefore: boolean;
  dismissed?: boolean;
}): boolean {
  if (!input.ashedConnectedOnDeviceBefore) {
    return false;
  }
  return shouldShowAshedConnectNudge({
    hasAppAccess: input.hasAppAccess,
    isConnected: input.isConnected,
    canUseAshedEmbeds: input.canUseAshedEmbeds,
    isAshedConnectAllowed: input.isAshedConnectAllowed,
    dismissed: input.dismissed ?? readAshedShellConnectDismissed(),
  });
}
