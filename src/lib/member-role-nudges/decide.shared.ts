import {
  crossedIntoOfficerRank,
  crossedOutOfOfficerRank,
  isBelowOfficerRoleName,
  isOfficerPlusRoleName,
  type MemberRoleNudgeKind,
} from "@/lib/member-role-nudges/types.shared";

export type RankNudgeDecision =
  | { action: "skip"; reason: string }
  | {
      action: "open";
      kind: MemberRoleNudgeKind;
      supersedeKinds: MemberRoleNudgeKind[];
    };

/**
 * Pure decision for R4 privilege nudges given prior/next rank and HQ state.
 */
export function decideMemberRoleNudge(input: {
  previousRank: number | null;
  nextRank: number | null;
  hqRoleName: string | null;
  hasActiveMembership: boolean;
  /** Latest resolved nudge for the candidate kind blocks re-open while state unchanged. */
  rejectedKindStillApplies: (kind: MemberRoleNudgeKind) => boolean;
}): RankNudgeDecision {
  const { previousRank, nextRank, hqRoleName, hasActiveMembership } = input;

  if (crossedIntoOfficerRank(previousRank, nextRank)) {
    if (isOfficerPlusRoleName(hqRoleName)) {
      return { action: "skip", reason: "already_officer_plus" };
    }
    const kind: MemberRoleNudgeKind =
      hasActiveMembership && isBelowOfficerRoleName(hqRoleName)
        ? "escalate_elevate"
        : "escalate_invite";
    if (input.rejectedKindStillApplies(kind)) {
      return { action: "skip", reason: "rejected_while_unchanged" };
    }
    return {
      action: "open",
      kind,
      supersedeKinds: ["deescalate"],
    };
  }

  if (crossedOutOfOfficerRank(previousRank, nextRank)) {
    if (hqRoleName === "owner" || hqRoleName === "maintainer") {
      return { action: "skip", reason: "never_demote_owner_maintainer" };
    }
    if (hqRoleName !== "officer") {
      return { action: "skip", reason: "not_hq_officer" };
    }
    if (input.rejectedKindStillApplies("deescalate")) {
      return { action: "skip", reason: "rejected_while_unchanged" };
    }
    return {
      action: "open",
      kind: "deescalate",
      supersedeKinds: ["escalate_invite", "escalate_elevate"],
    };
  }

  return { action: "skip", reason: "no_r4_crossing" };
}
