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

export { countActiveRosterMembers, ROSTER_MAX_MEMBERS };

export function parseInviteOnboardingMinRole(
  value: string | null | undefined,
): InviteOnboardingMinRole {
  return value === "owner" ? "owner" : "officer";
}
