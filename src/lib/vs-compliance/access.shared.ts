import { VS_COMPLIANCE_MANAGE_PERMISSION, VS_COMPLIANCE_READ_PERMISSION, VS_COMPLIANCE_SETTINGS_PERMISSION } from "@/lib/rbac/constants";

export type VsCompliancePermission = typeof VS_COMPLIANCE_READ_PERMISSION | typeof VS_COMPLIANCE_MANAGE_PERMISSION | typeof VS_COMPLIANCE_SETTINGS_PERMISSION;

export function canAccessVsCompliance(actor: {
  hqUserId: string | null;
  isPlatformMaintainer: boolean;
  roleName: string | null;
  permissions: ReadonlySet<string>;
}, permission: VsCompliancePermission): boolean {
  if (!actor.hqUserId) return false;
  if (actor.isPlatformMaintainer && actor.permissions.has("hq:admin")) return true;
  const roles = permission === VS_COMPLIANCE_SETTINGS_PERMISSION ? ["owner", "maintainer"] : ["owner", "maintainer", "officer"];
  return actor.roleName !== null && roles.includes(actor.roleName) && actor.permissions.has(permission);
}
