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

/**
 * Already-accepted invite / join-code rebind must honor the same claim deferral
 * as first accept. `preserve_existing` still applies `inviteRoleId` when there
 * is no active membership — so passing the elevated invite role on rebind
 * grants owner/officer before claim confirm (retry after provision failure,
 * concurrent rebind between mark-accepted and provision, or revoked row).
 *
 * Defer until the **bound commander** is linked to this acceptor — not merely
 * any alliance member link (a self-service link to a different roster row must
 * not clear the pending claim).
 */
export function resolveRoleIdForClaimBoundRebind(input: {
  inviteRoleId: string;
  claimTargetAshedMemberId: string | null | undefined;
  claimTargetHeldByAcceptor: boolean;
}): string {
  const claimTargetId = input.claimTargetAshedMemberId?.trim() || null;
  return resolveRoleIdForClaimPendingAccept({
    inviteRoleId: input.inviteRoleId,
    pendingClaimTargetId: input.claimTargetHeldByAcceptor ? null : claimTargetId,
  });
}
