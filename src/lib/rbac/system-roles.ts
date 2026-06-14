import { ROLE_IDS, type SystemRoleName } from "./constants";

export const SYSTEM_ROLE_NAMES = Object.keys(ROLE_IDS) as SystemRoleName[];

const ROLE_ID_SET = new Set<string>(Object.values(ROLE_IDS));

export function isSystemRoleId(roleId: string): boolean {
  return ROLE_ID_SET.has(roleId);
}

export function systemRoleIdForName(name: SystemRoleName): string {
  return ROLE_IDS[name];
}

export function systemRoleNameForId(roleId: string): SystemRoleName | null {
  const entry = Object.entries(ROLE_IDS).find(([, id]) => id === roleId);
  return (entry?.[0] as SystemRoleName | undefined) ?? null;
}
