/** Client-only: refetch alliance setup checklist after commander link, etc. */
export const ALLIANCE_SETUP_STATUS_REFRESH_EVENT =
  "alliance-setup-status:refresh";

export function dispatchAllianceSetupStatusRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ALLIANCE_SETUP_STATUS_REFRESH_EVENT));
}
