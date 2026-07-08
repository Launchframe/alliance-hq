import {
  ROSTER_MAX_MEMBERS,
  countActiveRosterMembers,
} from "@/lib/members/roster-rank-quota.shared";

export type InviteOnboardingMinRole = "officer" | "owner";

export function isSelfServiceOnboardingEnabled(
  settingEnabled: number | boolean,
): boolean {
  return settingEnabled === 1 || settingEnabled === true;
}

export function canCreateRosterMemberDuringOnboarding(
  activeMemberCount: number,
  maxMembers: number = ROSTER_MAX_MEMBERS,
): boolean {
  return activeMemberCount < maxMembers;
}

export function isSelfServiceServerEligible(input: {
  playerServerNumber: number | null | undefined;
  allianceServerNumber: number | null | undefined;
}): boolean {
  return (
    input.playerServerNumber != null &&
    input.allianceServerNumber != null &&
    input.playerServerNumber === input.allianceServerNumber
  );
}

export { countActiveRosterMembers, ROSTER_MAX_MEMBERS };

export function parseInviteOnboardingMinRole(
  value: string | null | undefined,
): InviteOnboardingMinRole {
  return value === "owner" ? "owner" : "officer";
}
