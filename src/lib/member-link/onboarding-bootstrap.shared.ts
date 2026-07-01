import type { LinkPendingState } from "@/lib/vr/types";

/** Initial wizard phases resolved before first paint (excludes transient submit outcomes). */
export type MemberLinkOnboardingInitialPhase =
  | "welcome"
  | "walkthrough"
  | "fuzzy"
  | "roster_miss"
  | "awaiting_owner"
  | "claim";

export type MemberLinkOnboardingInitialState = {
  phase: MemberLinkOnboardingInitialPhase;
  claimCommanderName?: string;
  candidates?: Array<{ memberId: string; name: string }>;
};

export function resolveMemberLinkOnboardingInitialState(input: {
  pending?: LinkPendingState | null;
  claimTarget?: { commanderName: string } | null;
}): MemberLinkOnboardingInitialState {
  const pending = input.pending;
  if (pending) {
    if (pending.kind === "link_walkthrough") {
      return { phase: "walkthrough" };
    }
    if (pending.kind === "link_fuzzy_pick") {
      return {
        phase: "fuzzy",
        candidates: pending.candidates ?? [],
      };
    }
    if (pending.kind === "link_roster_miss") {
      return { phase: "roster_miss" };
    }
    if (pending.kind === "link_awaiting_owner") {
      return { phase: "awaiting_owner" };
    }
  }

  if (input.claimTarget?.commanderName) {
    return {
      phase: "claim",
      claimCommanderName: input.claimTarget.commanderName,
    };
  }

  return { phase: "welcome" };
}
