import { ROLE_IDS } from "@/lib/rbac/constants";

/**
 * Hybrid / claim-bound invites must not grant the invite role until the
 * acceptor confirms the bound commander. Accept-time elevated RBAC sticks even
 * when claim confirm later fails (APIs ignore the member-link page gate).
 *
 * When a claim target is still pending, provision member only; claim confirm
 * elevates to the invite role.
 */
export function resolveRoleIdForClaimPendingAccept(input: {
  inviteRoleId: string;
  pendingClaimTargetId: string | null | undefined;
}): string {
  if (!input.pendingClaimTargetId?.trim()) {
    return input.inviteRoleId;
  }
  return ROLE_IDS.member;
}
