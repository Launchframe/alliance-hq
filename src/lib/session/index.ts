import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redirect } from "next/navigation";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { signingInUserMatchesConnectedSessionOwner } from "@/lib/auth/session-connect-identity";
import {
  allianceExists,
  listAlliancePickerOptions,
  listSessionAlliances,
  loadAlliancePickerOptionById,
  pickAllianceMembershipForSession,
  resolveSessionAllianceId,
  switchSessionCurrentAlliance,
} from "@/lib/alliance/session-memberships";
import { touchLinkedDeviceAccess } from "@/lib/credential-pairing/linked-devices";
import { decryptSecret, encryptSecret } from "@/lib/crypto/encrypt";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import type { AshedCredential, Session } from "@/lib/db/schema";
import {
  buildAshedConnectionMeta,
  resolveTokenExpiresAt,
  type AshedConnectionMeta,
} from "@/lib/jwt/connection-meta";
import { isTokenExpired } from "@/lib/jwt/decode";
import { capTokenExpiresAt } from "@/lib/member-link/privileged-link.shared";
import { DEFAULT_EXPIRY_REMINDER_DAYS } from "@/lib/jwt/decode";
import { getRbacContext } from "@/lib/rbac/context";
import { sessionHoldsAshedIdentityForHqUser } from "@/lib/rbac/ashed-session-membership";
import {
  rbacAllowsAshedConnect,
  sessionHasActiveMembership,
  sessionHasAppAccess,
  sessionHasNativeMembership,
  sessionRequiresMemberLink,
} from "@/lib/native-alliance/access";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { shouldShowTeamAccessNav } from "@/lib/settings/team-access-nav.shared";
import { shouldShowVideoProcessorsNav } from "@/lib/video/video-processors-nav.shared";
import { getAccountTimezoneIdForHqUser } from "@/lib/timezone/server";

export const SESSION_COOKIE = "alliance_hq_session";
const SESSION_DAYS = 90;

function sessionExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function readSessionId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value;
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!row || row.expiresAt <= new Date()) {
    return null;
  }

  void touchLinkedDeviceAccess(sessionId);

  return row;
}

/** For Server Components — redirects to bootstrap if no valid session. */
export async function requirePageSession(returnTo = "/"): Promise<Session> {
  const sessionId = await readSessionId();
  if (sessionId) {
    const existing = await loadSession(sessionId);
    if (existing) {
      return existing;
    }
  }

  const next = returnTo.startsWith("/") ? returnTo : `/${returnTo}`;
  redirect(`/api/auth/bootstrap?next=${encodeURIComponent(next)}`);
}

/** For Route Handlers — creates DB row and sets cookie on the response. */
export async function bootstrapSessionResponse(
  redirectTo: string,
  requestUrl: string,
): Promise<NextResponse> {
  const id = nanoid(32);
  const expiresAt = sessionExpiry();
  const now = new Date();
  const db = getDb();

  await db.insert(schema.sessions).values({
    id,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  const target = redirectTo.startsWith("/")
    ? new URL(redirectTo, requestUrl)
    : new URL("/", requestUrl);

  const response = NextResponse.redirect(target);
  response.cookies.set(SESSION_COOKIE, id, sessionCookieOptions(expiresAt));
  return response;
}

/** For Route Handlers — read or create session (cookies may be set). */
export async function getOrCreateSession(): Promise<Session> {
  const sessionId = await readSessionId();
  if (sessionId) {
    const existing = await loadSession(sessionId);
    if (existing) {
      return existing;
    }
  }

  const id = nanoid(32);
  const expiresAt = sessionExpiry();
  const now = new Date();

  const db = getDb();
  await db.insert(schema.sessions).values({
    id,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, sessionCookieOptions(expiresAt));

  return {
    id,
    userLabel: null,
    allianceId: null,
    allianceTag: null,
    hqUserId: null,
    currentAllianceId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
}

export async function getAshedCredentialRecord(
  sessionId: string,
): Promise<AshedCredential | null> {
  const db = getDb();
  const [cred] = await db
    .select()
    .from(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId))
    .limit(1);
  return cred ?? null;
}

/** Clears stored Ashed cred when the bound HQ user no longer holds that identity. */
async function clearOrphanAshedCredentialIfBoundUserMismatch(
  sessionId: string,
): Promise<boolean> {
  const session = await loadSession(sessionId);
  if (
    session?.hqUserId &&
    !(await sessionHoldsAshedIdentityForHqUser(sessionId, session.hqUserId))
  ) {
    await clearAshedConnection(sessionId);
    return true;
  }
  return false;
}

export async function getAshedConnection(
  sessionId: string,
): Promise<ParsedConnection | null> {
  const cred = await getAshedCredentialRecord(sessionId);
  if (!cred) {
    return null;
  }

  if (await clearOrphanAshedCredentialIfBoundUserMismatch(sessionId)) {
    return null;
  }

  return {
    appId: cred.appId,
    originUrl: cred.originUrl,
    token: decryptSecret(cred.encryptedToken),
  };
}

export async function getAshedConnectionMeta(
  sessionId: string,
  locale = "en-US",
): Promise<AshedConnectionMeta | null> {
  const cred = await getAshedCredentialRecord(sessionId);
  if (!cred) {
    return null;
  }

  if (await clearOrphanAshedCredentialIfBoundUserMismatch(sessionId)) {
    return null;
  }

  const session = await loadSession(sessionId);
  const timezone = await getAccountTimezoneIdForHqUser(session?.hqUserId);
  return buildAshedConnectionMeta(cred, locale, timezone);
}

export async function applyPrivilegedTokenCapForSession(
  sessionId: string,
): Promise<void> {
  const cred = await getAshedCredentialRecord(sessionId);
  if (!cred?.tokenExpiresAt) {
    return;
  }
  const capped = capTokenExpiresAt(cred.tokenExpiresAt);
  if (!capped || capped.getTime() === cred.tokenExpiresAt.getTime()) {
    return;
  }
  const db = getDb();
  await db
    .update(schema.ashedCredentials)
    .set({ tokenExpiresAt: capped, updatedAt: new Date() })
    .where(eq(schema.ashedCredentials.id, cred.id));
}

export async function updateExpiryReminderDays(
  sessionId: string,
  expiryReminderDays: number,
) {
  const db = getDb();
  await db
    .update(schema.ashedCredentials)
    .set({ expiryReminderDays, updatedAt: new Date() })
    .where(eq(schema.ashedCredentials.sessionId, sessionId));
}

export async function storeAshedConnection(
  sessionId: string,
  connection: ParsedConnection,
  userLabel: string | null,
  options?: {
    expiryReminderDays?: number;
    locale?: string;
    ashedUserId?: string | null;
    /** Cap JWT expiry at 30 days for owner/officer/platform maintainer connects. */
    applyPrivilegedTokenCap?: boolean;
  },
) {
  const db = getDb();
  const locale = options?.locale ?? "en-US";
  const now = new Date();
  const encryptedToken = encryptSecret(connection.token);
  let tokenExpiresAt = resolveTokenExpiresAt(connection.token);
  if (options?.applyPrivilegedTokenCap) {
    tokenExpiresAt = capTokenExpiresAt(tokenExpiresAt, now);
  }
  if (tokenExpiresAt && isTokenExpired(tokenExpiresAt)) {
    throw new Error("Connection key is already expired. Copy a fresh one from Ashed.");
  }

  const [existing] = await db
    .select()
    .from(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId))
    .limit(1);

  if (existing) {
    await db
      .update(schema.ashedCredentials)
      .set({
        appId: connection.appId,
        originUrl: connection.originUrl,
        encryptedToken,
        tokenExpiresAt,
        updatedAt: now,
        ...(options?.ashedUserId !== undefined
          ? { ashedUserId: options.ashedUserId }
          : {}),
        ...(options?.expiryReminderDays !== undefined
          ? { expiryReminderDays: options.expiryReminderDays }
          : {}),
      })
      .where(eq(schema.ashedCredentials.id, existing.id));
  } else {
    await db.insert(schema.ashedCredentials).values({
      id: nanoid(24),
      sessionId,
      ashedUserId: options?.ashedUserId ?? null,
      appId: connection.appId,
      originUrl: connection.originUrl,
      encryptedToken,
      tokenExpiresAt,
      expiryReminderDays:
        options?.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (userLabel) {
    await db
      .update(schema.sessions)
      .set({ userLabel, updatedAt: now })
      .where(eq(schema.sessions.id, sessionId));
  }

  return buildAshedConnectionMeta(
    {
      tokenExpiresAt,
      expiryReminderDays:
        options?.expiryReminderDays ??
        existing?.expiryReminderDays ??
        DEFAULT_EXPIRY_REMINDER_DAYS,
    },
    locale,
  );
}

/** Prefer canonical HQ user when this browser session holds a matching Ashed credential. */
export async function resolveEffectiveHqUserIdForSession(
  sessionId: string,
  magicLinkHqUserId: string | null,
): Promise<string | null> {
  if (!magicLinkHqUserId) {
    return null;
  }

  const db = getDb();
  const [signingInUser] = await db
    .select({ isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, magicLinkHqUserId))
    .limit(1);
  if (signingInUser?.isPlatformMaintainer === 1) {
    return magicLinkHqUserId;
  }

  const cred = await getAshedCredentialRecord(sessionId);
  const session = await loadSession(sessionId);

  if (cred?.ashedUserId && session?.hqUserId) {
    const sessionOwnerHoldsCred = await sessionHoldsAshedIdentityForHqUser(
      sessionId,
      session.hqUserId,
    );
    if (sessionOwnerHoldsCred) {
      if (
        await signingInUserMatchesConnectedSessionOwner({
          sessionId,
          signingInHqUserId: magicLinkHqUserId,
          sessionOwnerHqUserId: session.hqUserId,
        })
      ) {
        return session.hqUserId;
      }
    }
  }

  if (!cred?.ashedUserId) {
    return magicLinkHqUserId;
  }

  const holdsIdentity = await sessionHoldsAshedIdentityForHqUser(
    sessionId,
    magicLinkHqUserId,
  );
  if (!holdsIdentity) {
    return magicLinkHqUserId;
  }

  const [canonical] = await db
    .select({ id: schema.hqUsers.id })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.ashedUserId, cred.ashedUserId))
    .limit(1);

  return canonical?.id ?? magicLinkHqUserId;
}

export async function resolveBrowserSessionHqUserId(
  magicLinkHqUserId: string,
): Promise<string> {
  const session = await getOrCreateSession();
  return (
    (await resolveEffectiveHqUserIdForSession(session.id, magicLinkHqUserId)) ??
    magicLinkHqUserId
  );
}

export async function updateSessionAlliance(
  sessionId: string,
  connection: ParsedConnection,
  allianceTag: string,
) {
  const resolved = await resolveAllianceByTag(connection, allianceTag);
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({
      allianceTag: resolved.tag,
      allianceId: resolved.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
  return resolved;
}

export async function clearAshedConnection(sessionId: string) {
  const db = getDb();
  await db
    .delete(schema.ashedCredentials)
    .where(eq(schema.ashedCredentials.sessionId, sessionId));

  await db
    .update(schema.sessions)
    .set({
      allianceId: null,
      allianceTag: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
}

/** Clears alliance tenant pick from a browser session (sign-out, onboarding reset). */
export async function clearSessionAllianceContext(sessionId: string) {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({
      currentAllianceId: null,
      allianceId: null,
      allianceTag: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
}

/** Clears HQ user binding from a browser session (e.g. on sign-out). */
export async function clearSessionUserBinding(sessionId: string) {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({
      hqUserId: null,
      userLabel: null,
      currentAllianceId: null,
      allianceId: null,
      allianceTag: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
}

export async function ensureCurrentAllianceForSession(
  session: Session,
): Promise<Session> {
  if (!session.hqUserId) {
    return session;
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return session;
  }

  const rbac = await getRbacContext(session.id);
  const isPlatformMaintainer = rbac?.isPlatformMaintainer ?? false;

  if (session.currentAllianceId && isPlatformMaintainer) {
    const exists = await allianceExists(session.currentAllianceId);
    if (exists) {
      if (!session.allianceTag?.trim()) {
        await switchSessionCurrentAlliance(session, session.currentAllianceId);
        return (await loadSession(session.id)) ?? session;
      }
      return session;
    }
  }

  const alliances = await listSessionAlliances(effectiveHqUserId);
  const pick = pickAllianceMembershipForSession(session, alliances);
  if (pick) {
    await switchSessionCurrentAlliance(session, pick.id);
    return (await loadSession(session.id)) ?? session;
  }

  if (
    session.currentAllianceId &&
    !session.allianceTag?.trim() &&
    alliances.some((row) => row.id === session.currentAllianceId)
  ) {
    await switchSessionCurrentAlliance(session, session.currentAllianceId);
    return (await loadSession(session.id)) ?? session;
  }

  return session;
}

export async function getSessionStateFor(
  session: Session,
  locale = "en-US",
) {
  session = await ensureCurrentAllianceForSession(session);
  const connection = await getAshedConnection(session.id);
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  const timezone = await getAccountTimezoneIdForHqUser(effectiveHqUserId);
  const ashed = await getAshedConnectionMeta(session.id, locale);
  const rbac = await getRbacContext(session.id);
  const hasAppAccess = await sessionHasAppAccess(session);
  const isNativeMembership = await sessionHasNativeMembership(session);
  const hasActiveMembership = await sessionHasActiveMembership(session);
  const requiresMemberLink = await sessionRequiresMemberLink(session);
  const operatingMode = session.currentAllianceId
    ? await getAllianceOperatingMode(session.currentAllianceId)
    : null;
  const isAshedConnectAllowed = rbacAllowsAshedConnect(rbac, hasActiveMembership);
  const canUseAshedEmbeds =
    Boolean(rbac?.isPlatformMaintainer) ||
    (connection !== null && isAshedConnectAllowed);

  const membershipAlliances = effectiveHqUserId
    ? await listAlliancePickerOptions(
        effectiveHqUserId,
        rbac?.isPlatformMaintainer ?? false,
      )
    : [];

  const resolvedAllianceId = resolveSessionAllianceId(session);
  let currentAlliance =
    membershipAlliances.find((a) => a.id === resolvedAllianceId) ??
    membershipAlliances.find((a) => a.id === session.currentAllianceId) ??
    null;

  if (
    !currentAlliance &&
    resolvedAllianceId &&
    effectiveHqUserId &&
    rbac?.isPlatformMaintainer
  ) {
    currentAlliance = await loadAlliancePickerOptionById(
      resolvedAllianceId,
      effectiveHqUserId,
      true,
    );
  }

  const showTeamAccess = shouldShowTeamAccessNav({
    allianceId: resolvedAllianceId,
    hasActiveMembership,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
  });
  const showVideoProcessorsNav = shouldShowVideoProcessorsNav({
    allianceId: resolvedAllianceId,
    hasActiveMembership,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
  });

  return {
    sessionId: session.id,
    userLabel: session.userLabel,
    allianceId: session.allianceId,
    allianceTag: session.allianceTag,
    currentAllianceId: session.currentAllianceId,
    currentAllianceTag: currentAlliance?.tag ?? session.allianceTag,
    membershipAlliances,
    permissions: rbac ? Array.from(rbac.permissions) : [],
    hasActiveMembership,
    showTeamAccess,
    showVideoProcessorsNav,
    timezone,
    isConnected: connection !== null,
    hasAppAccess,
    requiresMemberLink,
    canUseAshedEmbeds,
    isNativeAlliance: isNativeMembership,
    operatingMode,
    expiresAt: session.expiresAt.toISOString(),
    ashed,
    rbac: rbac
      ? {
          roleName: rbac.roleName,
          isPlatformMaintainer: rbac.isPlatformMaintainer,
          isAllianceAdmin: rbac.permissions.has("alliance:admin"),
          isAshedConnectAllowed,
          email: rbac.email,
          displayName: rbac.displayName,
          avatarUrl: rbac.avatarUrl,
        }
      : null,
  };
}

export async function getSessionState(locale = "en-US") {
  const session = await getOrCreateSession();
  return getSessionStateFor(session, locale);
}

export async function getPageSessionState(returnTo = "/", locale = "en-US") {
  const session = await requirePageSession(returnTo);
  return getSessionStateFor(session, locale);
}
