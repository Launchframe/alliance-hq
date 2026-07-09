/** Claim confirm replaces lookup name with the invited commander (see claim.server). */
export const E2E_CLAIM_INVITE_MIRROR_UID = "1234567890121288";

/** `1234567890` + 4-digit server suffix → `E2eNativeOwner` on that server. */
export const PLAYER_UID_BYPASS_OWNER_PATTERN = /^1234567890(\d{4})$/;

export type PlayerUidBypassEntry = {
  uid: string;
  gameUserName: string;
  gameServerNumber: number;
  /** `onboard.uidBypass.entries.*` message key suffix. */
  descriptionKey:
    | "coldStartOwner"
    | "rosterMiss"
    | "wrongServer"
    | "substringMatch"
    | "claimTarget"
    | "claimMirror";
};

export const PLAYER_UID_BYPASS_ENTRIES: readonly PlayerUidBypassEntry[] = [
  {
    uid: "1234567890121203",
    gameUserName: "ColdStartOwner",
    gameServerNumber: 1203,
    descriptionKey: "coldStartOwner",
  },
  {
    uid: "1234567890121204",
    gameUserName: "E2eRosterMiss",
    gameServerNumber: 1203,
    descriptionKey: "rosterMiss",
  },
  {
    uid: "1234567890121205",
    gameUserName: "E2eWrongServer",
    gameServerNumber: 1205,
    descriptionKey: "wrongServer",
  },
  {
    uid: "1234567890121206",
    gameUserName: "Mew2407",
    gameServerNumber: 1203,
    descriptionKey: "substringMatch",
  },
  {
    uid: "1234567890121299",
    gameUserName: "E2eClaimTarget",
    gameServerNumber: 1203,
    descriptionKey: "claimTarget",
  },
  {
    uid: E2E_CLAIM_INVITE_MIRROR_UID,
    gameUserName: "E2eClaimInviteMirror",
    gameServerNumber: 1203,
    descriptionKey: "claimMirror",
  },
] as const;

export type PlayerUidBypassLookupResult = {
  ok: true;
  gameUserName: string;
  gameServerNumber: number;
};

export function lookupPlayerUidBypass(
  uid: string,
): PlayerUidBypassLookupResult | null {
  const trimmedUid = uid.trim();

  for (const entry of PLAYER_UID_BYPASS_ENTRIES) {
    if (entry.uid === trimmedUid) {
      return {
        ok: true,
        gameUserName: entry.gameUserName,
        gameServerNumber: entry.gameServerNumber,
      };
    }
  }

  const ownerMatch = trimmedUid.match(PLAYER_UID_BYPASS_OWNER_PATTERN);
  if (ownerMatch) {
    const gameServerNumber = Number.parseInt(ownerMatch[1]!, 10);
    return {
      ok: true,
      gameUserName: "E2eNativeOwner",
      gameServerNumber,
    };
  }

  return null;
}
