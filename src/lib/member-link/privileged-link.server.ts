import "server-only";

import { isTokenExpired } from "@/lib/jwt/decode";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import {
  getAshedCredentialRecord,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";

import {
  userRequiresAshedVerification,
  type PrivilegedHqRoleName,
} from "./privileged-link.shared";

export async function sessionHasLiveAshedVerification(
  sessionId: string,
  hqUserId: string,
): Promise<boolean> {
  const cred = await getAshedCredentialRecord(sessionId);
  if (!cred?.tokenExpiresAt || isTokenExpired(cred.tokenExpiresAt)) {
    return false;
  }
  return sessionHoldsAshedIdentityForHqUser(sessionId, hqUserId);
}

export function privilegedUserNeedsAshedGate(input: {
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): boolean {
  return userRequiresAshedVerification(input);
}

export type PrivilegedAshedGateResult =
  | { ok: true }
  | { ok: false; code: "ashed_verification_required" };

export async function assertPrivilegedAshedGate(input: {
  sessionId: string;
  hqUserId: string;
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): Promise<PrivilegedAshedGateResult> {
  if (
    !privilegedUserNeedsAshedGate({
      roleName: input.roleName,
      isPlatformMaintainer: input.isPlatformMaintainer,
    })
  ) {
    return { ok: true };
  }

  const live = await sessionHasLiveAshedVerification(
    input.sessionId,
    input.hqUserId,
  );
  if (!live) {
    return { ok: false, code: "ashed_verification_required" };
  }

  return { ok: true };
}

export function isPrivilegedHqRoleName(
  roleName: string | null | undefined,
): roleName is PrivilegedHqRoleName {
  return roleName === "owner" || roleName === "officer";
}

/** Privileged HQ roles must hold a live Ashed credential before using the app shell. */
export async function sessionRequiresAshedVerification(
  session: import("@/lib/db/schema").Session,
): Promise<boolean> {
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return false;
  }

  const { getRbacContext } = await import("@/lib/rbac/context");
  const rbac = await getRbacContext(session.id);
  if (
    !userRequiresAshedVerification({
      roleName: rbac?.roleName,
      isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
    })
  ) {
    return false;
  }

  return !(await sessionHasLiveAshedVerification(
    session.id,
    effectiveHqUserId,
  ));
}
