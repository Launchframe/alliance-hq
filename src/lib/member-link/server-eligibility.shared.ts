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
        | "known_home_mismatch"
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

  if (allianceServer == null) {
    return { kind: "rejected", reason: "alliance_server_unknown" };
  }

  // HQ already recorded a different home server for this UID — hard reject.
  // Position match and honor-system confirm must not override known home.
  if (knownHome != null && knownHome !== allianceServer) {
    return { kind: "rejected", reason: "known_home_mismatch" };
  }

  if (input.allianceHomeConfirmed) {
    return { kind: "eligible", reason: "user_confirmed_alliance_home" };
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
