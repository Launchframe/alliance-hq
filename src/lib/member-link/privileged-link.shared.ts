export const PRIVILEGED_HQ_ROLE_NAMES = ["owner", "officer"] as const;

export type PrivilegedHqRoleName = (typeof PRIVILEGED_HQ_ROLE_NAMES)[number];

const PRIVILEGED_ROLE_SET = new Set<string>(PRIVILEGED_HQ_ROLE_NAMES);

/** Ashed connect is optional for every role; HQ invite + member link gate access. */
export function roleRequiresAshedVerification(
  _roleName: string | null | undefined,
): boolean {
  return false;
}

/** Cap stored JWT lifetime when owner/officer voluntarily connect Ashed. */
export function roleReceivesPrivilegedTokenCap(
  roleName: string | null | undefined,
): boolean {
  if (!roleName) return false;
  return PRIVILEGED_ROLE_SET.has(roleName);
}

export function userRequiresAshedVerification(_input: {
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): boolean {
  return false;
}

/** Cap stored credential expiry at min(jwtExp, browser session expiresAt). */
export function capTokenExpiresAtAtSession(
  jwtExp: Date | null,
  sessionExpiresAt: Date | null,
): Date | null {
  if (!jwtExp) return null;
  if (!sessionExpiresAt) return jwtExp;
  return jwtExp.getTime() <= sessionExpiresAt.getTime()
    ? jwtExp
    : sessionExpiresAt;
}

/** @deprecated Use capTokenExpiresAtAtSession — session-scoped cap replaces 30-day privileged window. */
export function capTokenExpiresAt(
  jwtExp: Date | null,
  sessionExpiresAt: Date | null = null,
): Date | null {
  return capTokenExpiresAtAtSession(jwtExp, sessionExpiresAt);
}
