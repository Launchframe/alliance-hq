/** Inbox reminder kind for pending roster link owner approvals. */
export const ROSTER_LINK_INBOX_KIND = "member_link_request" as const;

export function rosterLinkRequestHref(requestId: string): string {
  return `/members/roster-link-requests?request=${encodeURIComponent(requestId)}`;
}

/** Prefer the review page for roster-link items (legacy rows used href `/inbox`). */
export function resolveRosterLinkInboxHref(item: {
  kind: string;
  resourceId: string | null;
  href: string | null;
}): string | null {
  if (item.kind !== ROSTER_LINK_INBOX_KIND) {
    return item.href;
  }
  if (item.resourceId) {
    return rosterLinkRequestHref(item.resourceId);
  }
  if (item.href === "/inbox" || !item.href) {
    return "/members/roster-link-requests";
  }
  return item.href;
}
