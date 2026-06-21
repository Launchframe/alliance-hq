import "server-only";

import { redirect } from "@/i18n/navigation";

import {
  listSessionAlliances,
  findSessionAllianceMembership,
  pickAllianceMembershipForSession,
  resolveSessionAllianceId,
} from "@/lib/alliance/session-memberships";
import { sessionHasActiveMembership } from "@/lib/native-alliance/access";
import { sessionIsPlatformMaintainer } from "@/lib/rbac/context";
import type { Session } from "@/lib/db/schema";
import {
  ensureCurrentAllianceForSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { shouldShowTeamAccessNav } from "@/lib/settings/team-access-nav.shared";

export { shouldShowTeamAccessNav };

export async function resolveAllianceTagForSession(
  session: Session,
): Promise<string | null> {
  if (session.allianceTag?.trim()) {
    return session.allianceTag.trim();
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return null;
  }

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return null;
  }

  const alliances = await listSessionAlliances(effectiveHqUserId);
  const current = alliances.find((row) => row.id === allianceId);
  return current?.tag?.trim() ?? current?.slug ?? null;
}

export type AllianceSettingsAccess =
  | { kind: "ready"; session: Session }
  | { kind: "pick_alliance"; alliances: Awaited<ReturnType<typeof listSessionAlliances>> }
  | { kind: "redirect"; href: "/get-started" };

export async function shouldShowTeamAccessNavForSession(
  session: Session,
): Promise<boolean> {
  const resolved = await ensureCurrentAllianceForSession(session);
  const allianceId = resolveSessionAllianceId(resolved);
  const hasMembership = await sessionHasActiveMembership(resolved);
  const isMaintainer = await sessionIsPlatformMaintainer(resolved.id);
  return shouldShowTeamAccessNav({
    allianceId,
    hasActiveMembership: hasMembership,
    isPlatformMaintainer: isMaintainer,
  });
}

export async function resolveAllianceSettingsAccess(
  session: Session,
): Promise<AllianceSettingsAccess> {
  const resolved = await ensureCurrentAllianceForSession(session);
  if (await sessionHasActiveMembership(resolved)) {
    return { kind: "ready", session: resolved };
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    resolved.id,
    resolved.hqUserId,
  );
  const alliances = effectiveHqUserId
    ? await listSessionAlliances(effectiveHqUserId)
    : [];

  if (findSessionAllianceMembership(resolved, alliances)) {
    return { kind: "ready", session: resolved };
  }

  if (await sessionIsPlatformMaintainer(resolved.id)) {
    return { kind: "ready", session: resolved };
  }

  if (
    alliances.length > 1 &&
    !pickAllianceMembershipForSession(resolved, alliances)
  ) {
    return { kind: "pick_alliance", alliances };
  }

  return { kind: "redirect", href: "/get-started" };
}

export async function requireAllianceSettingsSession(
  session: Session,
  locale: string,
): Promise<
  | { session: Session; allianceId: string | null }
  | { pickAlliance: Awaited<ReturnType<typeof listSessionAlliances>> }
> {
  const access = await resolveAllianceSettingsAccess(session);
  if (access.kind === "pick_alliance") {
    return { pickAlliance: access.alliances };
  }

  if (access.kind === "ready") {
    return {
      session: access.session,
      allianceId: resolveSessionAllianceId(access.session),
    };
  }

  redirect({ href: access.href, locale });
  throw new Error("Redirecting to onboarding.");
}
