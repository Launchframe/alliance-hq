import "server-only";

import { isTokenExpired } from "@/lib/jwt/decode";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import {
  getAshedCredentialRecord,
} from "@/lib/session";

import {
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

export function privilegedUserNeedsAshedGate(_input: {
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): boolean {
  return false;
}

export type PrivilegedAshedGateResult =
  | { ok: true }
  | { ok: false; code: "ashed_verification_required" };

export async function assertPrivilegedAshedGate(_input: {
  sessionId: string;
  hqUserId: string;
  roleName: string | null | undefined;
  isPlatformMaintainer: boolean;
}): Promise<PrivilegedAshedGateResult> {
  return { ok: true };
}

export function isPrivilegedHqRoleName(
  roleName: string | null | undefined,
): roleName is PrivilegedHqRoleName {
  return roleName === "owner" || roleName === "officer";
}

/** Ashed is optional; always false (kept for session state shape). */
export async function sessionRequiresAshedVerification(
  _session: import("@/lib/db/schema").Session,
): Promise<boolean> {
  return false;
}
