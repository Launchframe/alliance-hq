import type { RbacContext } from "@/lib/rbac/context";
import { ALLIANCE_ADMIN_PERMISSION } from "@/lib/rbac/constants";

/**
 * Owners / maintainers / alliance admins / platform maintainers — not base officers.
 * Used to gate HQ officer → member demotion on Team settings.
 */
export function canRevokeOfficerAccess(ctx: RbacContext): boolean {
  if (ctx.isPlatformMaintainer) return true;
  if (ctx.roleName === "owner" || ctx.roleName === "maintainer") return true;
  if (ctx.permissions.has(ALLIANCE_ADMIN_PERMISSION)) return true;
  return false;
}
