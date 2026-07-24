/**
 * Last War UID lookup `server` is the commander's current map position, not
 * necessarily their home state server. Gate onboarding on alliance home +
 * known commander records, not transient position alone.
 */

export type ServerEligibilityReason =
  | "lookup_matches"
  | "known_commander_home"
  | "user_confirmed_alliance_home";

export type ServerEligibilityResult =
  | { kind: "eligible"; reason: ServerEligibilityReason }
  | { kind: "confirm_home"; lookupServer: number; allianceServer: number }
  | {
      kind: "rejected";
      reason:
        | "user_claimed_lookup_home"
        | "missing_server"
        | "alliance_server_unknown";
    };

export function resolveMemberLinkServerEligibility(input: {
  lookupServer: number | null | undefined;
  allianceServer: number | null | undefined;
  knownCommanderHomeServer: number | null | undefined;
  allianceHomeConfirmed?: boolean;
  userClaimedLookupAsHome?: boolean;
}): ServerEligibilityResult {
  if (input.userClaimedLookupAsHome) {
    return { kind: "rejected", reason: "user_claimed_lookup_home" };
  }

  const allianceServer = input.allianceServer ?? null;
  const lookupServer = input.lookupServer ?? null;
  const knownHome = input.knownCommanderHomeServer ?? null;

  if (input.allianceHomeConfirmed && allianceServer != null) {
    return { kind: "eligible", reason: "user_confirmed_alliance_home" };
  }

  if (allianceServer == null) {
    return { kind: "rejected", reason: "alliance_server_unknown" };
  }

  if (knownHome != null && knownHome === allianceServer) {
    return { kind: "eligible", reason: "known_commander_home" };
  }

  if (lookupServer != null && lookupServer === allianceServer) {
    return { kind: "eligible", reason: "lookup_matches" };
  }

  if (lookupServer != null && lookupServer !== allianceServer) {
    return {
      kind: "confirm_home",
      lookupServer,
      allianceServer,
    };
  }

  return { kind: "rejected", reason: "missing_server" };
}
