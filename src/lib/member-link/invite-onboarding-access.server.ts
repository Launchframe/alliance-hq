import "server-only";

import type { RbacContext } from "@/lib/rbac/context";
import { canManageTeamInvites } from "@/lib/native-alliance/team-invites.server";
import type { InviteOnboardingMinRole } from "@/lib/member-link/self-service-onboarding.shared";

export function isAllianceOwnerForAccess(
  ctx: RbacContext,
  alliance: { ownerHqUserId: string | null },
): boolean {
  return ctx.roleName === "owner" || alliance.ownerHqUserId === ctx.hqUserId;
}

export function canManageInvitesAndOnboarding(
  ctx: RbacContext,
  alliance: {
    ownerHqUserId: string | null;
    inviteOnboardingMinRole: string;
  },
): boolean {
  if (ctx.isPlatformMaintainer) return true;
  if (alliance.inviteOnboardingMinRole === "owner") {
    return isAllianceOwnerForAccess(ctx, alliance);
  }
  return canManageTeamInvites(ctx);
}

export function canReviewMemberLinks(
  ctx: RbacContext,
  alliance: {
    ownerHqUserId: string | null;
    inviteOnboardingMinRole: string;
  },
): boolean {
  if (ctx.isPlatformMaintainer) return true;
  if (alliance.inviteOnboardingMinRole === "owner") {
    return isAllianceOwnerForAccess(ctx, alliance);
  }
  return ctx.permissions.has("members:write");
}

export function isOwnerOnlyInviteOnboarding(
  inviteOnboardingMinRole: string,
): boolean {
  return inviteOnboardingMinRole === "owner";
}

export type { InviteOnboardingMinRole };
