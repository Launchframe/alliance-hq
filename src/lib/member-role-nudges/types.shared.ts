export const MEMBER_ROLE_NUDGE_KINDS = [
  "escalate_invite",
  "escalate_elevate",
  "deescalate",
] as const;

export type MemberRoleNudgeKind = (typeof MEMBER_ROLE_NUDGE_KINDS)[number];

export const MEMBER_ROLE_NUDGE_STATUSES = [
  "open",
  "accepted",
  "rejected",
  "superseded",
] as const;

export type MemberRoleNudgeStatus = (typeof MEMBER_ROLE_NUDGE_STATUSES)[number];

export const MEMBERSHIP_ROLE_EVENT_SOURCES = [
  "nudge_accept",
  "invite_accept",
  "admin",
  "ashed_sync",
  "join_code",
  "team_revoke",
  "team_elevate",
] as const;

export type MembershipRoleEventSource =
  (typeof MEMBERSHIP_ROLE_EVENT_SOURCES)[number];

export const MEMBER_ROLE_ESCALATE_INBOX_KIND = "member_role_escalate";
export const MEMBER_ROLE_DEESCALATE_INBOX_KIND = "member_role_deescalate";

export const OFFICER_RANK = 4;

export function isOfficerPlusRoleName(
  roleName: string | null | undefined,
): boolean {
  return (
    roleName === "owner" ||
    roleName === "maintainer" ||
    roleName === "officer"
  );
}

export function isBelowOfficerRoleName(
  roleName: string | null | undefined,
): boolean {
  return (
    roleName === "member" ||
    roleName === "viewer" ||
    roleName === "data_entry"
  );
}

export function crossedIntoOfficerRank(
  previousRank: number | null | undefined,
  nextRank: number | null | undefined,
): boolean {
  if (nextRank !== OFFICER_RANK) return false;
  if (previousRank == null) return true;
  return previousRank < OFFICER_RANK;
}

export function crossedOutOfOfficerRank(
  previousRank: number | null | undefined,
  nextRank: number | null | undefined,
): boolean {
  if (previousRank !== OFFICER_RANK) return false;
  if (nextRank == null) return true;
  return nextRank < OFFICER_RANK;
}

export function memberRoleNudgeHref(nudgeId: string): string {
  return `/settings/team?nudge=${encodeURIComponent(nudgeId)}`;
}

export function isMemberRoleNudgeKind(
  value: string,
): value is MemberRoleNudgeKind {
  return (MEMBER_ROLE_NUDGE_KINDS as readonly string[]).includes(value);
}
