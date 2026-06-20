import { ROLE_IDS, type SystemRoleName } from "./constants";

export const SYSTEM_ROLE_NAMES = Object.keys(ROLE_IDS) as SystemRoleName[];

const ROLE_ID_SET = new Set<string>(Object.values(ROLE_IDS));

/** Higher index = higher privilege for manual → Ashed sync upgrades. */
const SYSTEM_ROLE_RANK: Record<SystemRoleName, number> = {
  member: 0,
  viewer: 1,
  data_entry: 2,
  officer: 3,
  maintainer: 4,
  owner: 5,
};

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

export function shouldUpgradeSystemRole(
  currentRoleName: SystemRoleName,
  nextRoleName: SystemRoleName,
): boolean {
  return SYSTEM_ROLE_RANK[nextRoleName] > SYSTEM_ROLE_RANK[currentRoleName];
}
