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
