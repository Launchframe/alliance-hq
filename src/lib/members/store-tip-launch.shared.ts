/**
 * Launch paths for Last War gold-brick store deep-links.
 *
 * Clients must navigate/open these routes directly. The handlers 302 to Last War
 * and must never return `loginToken` or `uid` in a JSON body (see
 * `LAST_WAR_STORE_LOGIN_TOKEN` — server-only partner credential).
 */

export function publicStoreTipLaunchPath(code: string): string {
  return `/api/public/store-tip/${encodeURIComponent(code.trim())}/launch`;
}

export function commanderDonationStoreLaunchPath(ashedMemberId: string): string {
  return `/api/members/${encodeURIComponent(ashedMemberId.trim())}/donation-store`;
}
