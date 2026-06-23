export const PRIVILEGED_HQ_ROLE_NAMES = ["owner", "officer"] as const;

export type PrivilegedHqRoleName = (typeof PRIVILEGED_HQ_ROLE_NAMES)[number];

export const PRIVILEGED_TOKEN_MAX_DAYS = 30;

const PRIVILEGED_ROLE_SET = new Set<string>(PRIVILEGED_HQ_ROLE_NAMES);

export function roleRequiresAshedVerification(
  roleName: string | null | undefined,
): boolean {
  if (!roleName) return false;
  return PRIVILEGED_ROLE_SET.has(roleName);
}

export function userRequiresAshedVerification(input: {
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): boolean {
  return (
    input.isPlatformMaintainer ||
    roleRequiresAshedVerification(input.roleName)
  );
}

/** Cap stored credential expiry at min(jwtExp, now + 30 days). */
export function capTokenExpiresAt(
  jwtExp: Date | null,
  now: Date = new Date(),
): Date | null {
  if (!jwtExp) return null;
  const ceiling = new Date(now);
  ceiling.setUTCDate(ceiling.getUTCDate() + PRIVILEGED_TOKEN_MAX_DAYS);
  return jwtExp.getTime() <= ceiling.getTime() ? jwtExp : ceiling;
}
