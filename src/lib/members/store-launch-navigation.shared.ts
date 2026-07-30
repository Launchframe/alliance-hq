/**
 * Launch routes redirect to Last War with a login token in the URL. Only allow
 * top-level browser navigations — reject fetch/XHR/HEAD so tokens are not
 * harvestable via programmatic clients.
 */
export function isBrowserDocumentNavigation(request: Request): boolean {
  if (request.method === "HEAD") return false;
  const mode = request.headers.get("sec-fetch-mode");
  if (mode !== "navigate") return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && dest !== "document" && dest !== "iframe") return false;
  return true;
}

export type DonationLaunchErrorCode =
  | "recipient_uid_unavailable"
  | "donation_store_unavailable"
  | "forbidden"
  | "not_found"
  | "self_gift_blocked"
  | "hq_user_required";

export function donationLaunchErrorMessageKey(
  code: string,
): "donationUnavailable" | "donationStoreUnavailable" | "donationLaunchFailed" {
  switch (code) {
    case "recipient_uid_unavailable":
      return "donationUnavailable";
    case "donation_store_unavailable":
      return "donationStoreUnavailable";
    default:
      return "donationLaunchFailed";
  }
}

const DONATION_LAUNCH_PENDING_PREFIX = "hq-donation-launch-pending:";

export function donationLaunchPendingKey(ashedMemberId: string): string {
  return `${DONATION_LAUNCH_PENDING_PREFIX}${ashedMemberId}`;
}
