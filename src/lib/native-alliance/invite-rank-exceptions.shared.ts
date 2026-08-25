import type { SystemRoleName } from "@/lib/rbac/constants";

/** In-game R4 — HQ officers may issue hybrid officer+claim invites. */
export const HYBRID_OFFICER_INVITE_RANK = 4;

/** In-game R5 — HQ officers (and owners) may issue hybrid owner+claim invites. */
export const HYBRID_OWNER_INVITE_RANK = 5;

/**
 * Leadership hybrid invite role for a roster commander's in-game rank.
 * R4 → officer, R5 → owner; other ranks have no leadership exception.
 */
export function hybridLeadershipInviteRoleForRank(
  allianceRank: number | null | undefined,
): Extract<SystemRoleName, "officer" | "owner"> | null {
  if (allianceRank === HYBRID_OFFICER_INVITE_RANK) return "officer";
  if (allianceRank === HYBRID_OWNER_INVITE_RANK) return "owner";
  return null;
}
