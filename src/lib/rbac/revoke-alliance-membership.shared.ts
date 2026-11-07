export type MembershipRevokeCode = "last_owner" | "only_membership" | "not_found";

/**
 * Written by explicit leave and admin remove.
 * `source: "manual"` is what keeps Ashed sync from reactivating the row.
 */
export const EXPLICIT_MEMBERSHIP_REVOKE_PATCH = {
  status: "revoked",
  source: "manual",
} as const;

export type MembershipRevokeDecision =
  | { ok: true; nextAllianceId: string | null }
  | { ok: false; code: Exclude<MembershipRevokeCode, "not_found"> };

/**
 * Last active owner cannot be revoked.
 * Self-leave also requires another active membership so the account keeps an alliance.
 * `otherAllianceIds` must already exclude the membership being revoked.
 */
export function decideAllianceMembershipRevoke(input: {
  mode: "self" | "admin";
  targetIsOwner: boolean;
  activeOwnerCount: number;
  activeMembershipCount: number;
  otherAllianceIds: readonly string[];
}): MembershipRevokeDecision {
  if (input.mode === "self" && input.activeMembershipCount <= 1) {
    return { ok: false, code: "only_membership" };
  }
  if (input.targetIsOwner && input.activeOwnerCount <= 1) {
    return { ok: false, code: "last_owner" };
  }
  return { ok: true, nextAllianceId: input.otherAllianceIds[0] ?? null };
}

/** Sessions sitting on the revoked alliance move to the next membership. Others stay put. */
export function sessionAllianceAfterRevoke(input: {
  sessionAllianceId: string | null;
  revokedAllianceId: string;
  nextAllianceId: string | null;
}): string | null {
  if (input.sessionAllianceId !== input.revokedAllianceId) {
    return input.sessionAllianceId;
  }
  return input.nextAllianceId;
}

export function leaveBlockedReasonForMembership(input: {
  roleName: string;
  activeOwnerCount: number;
}): "last_owner" | null {
  if (input.roleName !== "owner") return null;
  return input.activeOwnerCount <= 1 ? "last_owner" : null;
}
