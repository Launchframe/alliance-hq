import "server-only";

import {
  lookupPlayerByUid as lookupPlayerByUidCore,
  type LastWarPlayerLookupResult,
} from "@/lib/lastwar/player-lookup";
import { notifyLastWarUidLookupOutage } from "@/lib/lastwar/lookup-outage-alert.server";

export {
  E2E_CLAIM_INVITE_MIRROR_UID,
  INVALID_GAME_UID_MESSAGE,
  buildLastWarPlayerLookupUrl,
  isClaimInviteMirrorDevUid,
  isValidGameUid,
  normalizeLastWarAvatarUrl,
  parseGameServerNumberFromUid,
  parseLastWarAvatarUrl,
  parseLastWarGameServerNumber,
  parseLastWarGameUserLevel,
  parseLastWarLookupResponse,
} from "@/lib/lastwar/player-lookup";
export type {
  LastWarPlayerLookupResponse,
  LastWarPlayerLookupResult,
} from "@/lib/lastwar/player-lookup";

/**
 * Server entry for UID → name lookup. Wraps the shared fetch and alerts
 * maintainers (deduped) when Last War returns request_failed.
 */
export async function lookupPlayerByUid(
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LastWarPlayerLookupResult> {
  const result = await lookupPlayerByUidCore(uid, fetchImpl);
  if (!result.ok && result.reason === "request_failed") {
    void notifyLastWarUidLookupOutage({ detail: result.message }).catch(
      (error) => {
        console.error("[lastwar] lookup outage alert failed", error);
      },
    );
  }
  return result;
}
