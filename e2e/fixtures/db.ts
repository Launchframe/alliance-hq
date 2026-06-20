import { createHash, randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import postgres from "postgres";

import { encryptSecret } from "../../src/lib/crypto/encrypt";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
} from "../../src/lib/connectionString";
import { ROLE_IDS } from "../../src/lib/rbac/constants";
import { shouldUpgradeSystemRole } from "../../src/lib/rbac/system-roles";

const SESSION_COOKIE = "alliance_hq_session";

export type Sql = ReturnType<typeof postgres>;

export function getE2eSql(): Sql {
  const url =
    process.env.E2E_DATABASE_URL?.trim() ||
    process.env.LOCAL_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("E2E database URL is not configured.");
  }
  return postgres(url, { max: 4, prepare: false });
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export type SessionFixture = {
  sessionId: string;
  hqUserId: string;
  email: string;
};

export async function createPlatformMaintainerSession(
  sql: Sql,
): Promise<SessionFixture> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const sessionId = nanoid(32);
  const hqUserId = nanoid(16);
  const email = `maintainer-${nanoid(8)}@e2e.test`;

  await sql`
    INSERT INTO hq_users (
      id, email, display_name, is_platform_maintainer, access_granted_at, created_at, updated_at
    ) VALUES (
      ${hqUserId}, ${email}, ${"E2E Maintainer"}, 1, ${now}, ${now}, ${now}
    )
  `;

  await sql`
    INSERT INTO sessions (id, created_at, updated_at, expires_at, hq_user_id)
    VALUES (${sessionId}, ${now}, ${now}, ${expiresAt}, ${hqUserId})
  `;

  return { sessionId, hqUserId, email };
}

export async function createNativeAlliance(
  sql: Sql,
  options: { tag: string; name: string; ownerHqUserId?: string | null },
): Promise<{ allianceId: string; tag: string }> {
  const now = new Date();
  const allianceId = nanoid(16);
  const slug = `e2e-${options.tag.toLowerCase()}-${nanoid(4)}`;

  await sql`
    INSERT INTO alliances (
      id, slug, tag, name, operating_mode, owner_hq_user_id, created_at, updated_at
    ) VALUES (
      ${allianceId},
      ${slug},
      ${options.tag},
      ${options.name},
      ${"native"},
      ${options.ownerHqUserId ?? null},
      ${now},
      ${now}
    )
  `;

  return { allianceId, tag: options.tag };
}

export async function createHqInviteRow(
  sql: Sql,
  input: {
    allianceId: string;
    email: string;
    roleName: keyof typeof ROLE_IDS;
    redirectPath?: string | null;
    invitedByHqUserId?: string | null;
  },
): Promise<{ token: string; inviteId: string }> {
  const token = inviteToken();
  const tokenHash = hashInviteToken(token);
  const inviteId = nanoid(16);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const roleId = ROLE_IDS[input.roleName];

  await sql`
    INSERT INTO roles (id, alliance_id, name, description, is_system)
    VALUES (
      ${roleId},
      NULL,
      ${input.roleName},
      ${`${input.roleName} system role`},
      1
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO hq_invites (
      id,
      alliance_id,
      email,
      role_id,
      token_hash,
      invited_by_hq_user_id,
      expires_at,
      redirect_path,
      created_at
    ) VALUES (
      ${inviteId},
      ${input.allianceId},
      ${input.email.toLowerCase()},
      ${roleId},
      ${tokenHash},
      ${input.invitedByHqUserId ?? null},
      ${expiresAt},
      ${input.redirectPath ?? null},
      ${now}
    )
  `;

  return { token, inviteId };
}

export async function acceptInviteViaApi(
  baseURL: string,
  token: string,
  email: string,
  next?: string,
  sessionId?: string,
): Promise<{ sessionId: string; redirectTo: string; hqUserId: string }> {
  let browserSessionId = sessionId;

  if (!browserSessionId) {
    const bootstrap = await fetch(
      `${baseURL}/api/auth/session?next=${encodeURIComponent("/")}`,
      { redirect: "manual" },
    );
    const setCookie = bootstrap.headers.get("set-cookie") ?? "";
    const sessionMatch = setCookie.match(
      new RegExp(`${SESSION_COOKIE}=([^;]+)`),
    );
    if (!sessionMatch?.[1]) {
      throw new Error("Failed to bootstrap invite-accept session.");
    }
    browserSessionId = sessionMatch[1];
  }

  const res = await fetch(`${baseURL}/api/invite/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${SESSION_COOKIE}=${browserSessionId}`,
    },
    body: JSON.stringify({
      email,
      displayName: "E2E User",
      next,
    }),
  });

  const body = (await res.json()) as {
    redirectTo?: string;
    error?: string;
    hqUserId?: string;
  };

  if (!res.ok) {
    throw new Error(body.error ?? "Invite accept failed.");
  }

  return {
    sessionId: browserSessionId,
    hqUserId: body.hqUserId ?? "",
    redirectTo: body.redirectTo ?? "/connect?welcome=1",
  };
}

export async function loadMembershipRoleName(
  sql: Sql,
  hqUserId: string,
  allianceId: string,
): Promise<string | null> {
  const [row] = await sql<{ name: string }[]>`
    SELECT r.name
    FROM alliance_memberships m
    INNER JOIN roles r ON r.id = m.role_id
    WHERE m.hq_user_id = ${hqUserId}
      AND m.alliance_id = ${allianceId}
      AND m.status = 'active'
    LIMIT 1
  `;
  return row?.name ?? null;
}

export function sessionCookie(sessionId: string) {
  return {
    name: SESSION_COOKIE,
    value: sessionId,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}

export async function attachAshedConnectionToSession(
  sql: Sql,
  sessionId: string,
  options?: { ashedUserId?: string | null },
): Promise<void> {
  const now = new Date();
  const credId = nanoid(24);
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO ashed_credentials (
      id,
      session_id,
      ashed_user_id,
      app_id,
      origin_url,
      encrypted_token,
      token_expires_at,
      expiry_reminder_days,
      created_at,
      updated_at
    ) VALUES (
      ${credId},
      ${sessionId},
      ${options?.ashedUserId ?? null},
      ${DEFAULT_APP_ID},
      ${DEFAULT_ORIGIN_URL},
      ${encryptSecret("e2e-fake-ashed-token")},
      ${expiresAt},
      14,
      ${now},
      ${now}
    )
  `;
}

export async function createBrowserSession(
  sql: Sql,
  options?: { hqUserId?: string | null },
): Promise<{ sessionId: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const sessionId = nanoid(32);

  await sql`
    INSERT INTO sessions (id, created_at, updated_at, expires_at, hq_user_id)
    VALUES (${sessionId}, ${now}, ${now}, ${expiresAt}, ${options?.hqUserId ?? null})
  `;

  return { sessionId };
}

export async function createAuthenticatedHqSession(
  sql: Sql,
  email: string,
  options?: { displayName?: string; accessGranted?: boolean },
): Promise<SessionFixture> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const sessionId = nanoid(32);
  const hqUserId = nanoid(16);
  const normalizedEmail = email.toLowerCase();
  const displayName = options?.displayName ?? "E2E User";

  await sql`
    INSERT INTO hq_users (
      id, email, display_name, access_granted_at, created_at, updated_at
    ) VALUES (
      ${hqUserId},
      ${normalizedEmail},
      ${displayName},
      ${options?.accessGranted === false ? null : now},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO sessions (id, created_at, updated_at, expires_at, hq_user_id)
    VALUES (${sessionId}, ${now}, ${now}, ${expiresAt}, ${hqUserId})
  `;

  return {
    sessionId,
    hqUserId,
    email: normalizedEmail,
  };
}

export async function createMagicLinkSession(
  sql: Sql,
  email: string,
): Promise<SessionFixture> {
  return createAuthenticatedHqSession(sql, email);
}

export async function createCanonicalAshedHqUser(
  sql: Sql,
  input: { email: string; ashedUserId: string; displayName?: string },
): Promise<{ hqUserId: string }> {
  const now = new Date();
  const hqUserId = nanoid(16);

  await sql`
    INSERT INTO hq_users (
      id, email, display_name, ashed_user_id, access_granted_at, created_at, updated_at
    ) VALUES (
      ${hqUserId},
      ${input.email.toLowerCase()},
      ${input.displayName ?? "E2E Canonical"},
      ${input.ashedUserId},
      ${now},
      ${now},
      ${now}
    )
  `;

  return { hqUserId };
}

export async function createAllianceMembership(
  sql: Sql,
  input: {
    hqUserId: string;
    allianceId: string;
    roleName: keyof typeof ROLE_IDS;
    source: "manual" | "ashed";
  },
): Promise<void> {
  const now = new Date();
  const membershipId = nanoid(16);
  const roleId = ROLE_IDS[input.roleName];

  await sql`
    INSERT INTO roles (id, alliance_id, name, description, is_system)
    VALUES (
      ${roleId},
      NULL,
      ${input.roleName},
      ${`${input.roleName} system role`},
      1
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO alliance_memberships (
      id, alliance_id, hq_user_id, role_id, source, status, created_at, updated_at
    ) VALUES (
      ${membershipId},
      ${input.allianceId},
      ${input.hqUserId},
      ${roleId},
      ${input.source},
      ${"active"},
      ${now},
      ${now}
    )
  `;
}

export async function sessionHasAshedCredential(
  sql: Sql,
  sessionId: string,
): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id
    FROM ashed_credentials
    WHERE session_id = ${sessionId}
    LIMIT 1
  `;
  return Boolean(row?.id);
}

export async function fetchConnectSessionState(
  baseURL: string,
  sessionId: string,
): Promise<{
  isConnected: boolean;
  canUseAshedEmbeds: boolean;
  roleName: string | null;
}> {
  const res = await fetch(`${baseURL}/api/auth/connect`, {
    headers: {
      Cookie: `${SESSION_COOKIE}=${sessionId}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load session state: ${res.status}`);
  }
  const body = (await res.json()) as {
    isConnected?: boolean;
    canUseAshedEmbeds?: boolean;
    rbac?: { roleName?: string | null } | null;
  };
  return {
    isConnected: body.isConnected === true,
    canUseAshedEmbeds: body.canUseAshedEmbeds === true,
    roleName: body.rbac?.roleName ?? null,
  };
}

export async function simulateManualMembershipAshedUpgrade(
  sql: Sql,
  hqUserId: string,
  allianceId: string,
  nextRoleName: keyof typeof ROLE_IDS,
): Promise<boolean> {
  const [membership] = await sql<
    { id: string; role_id: string; source: string }[]
  >`
    SELECT id, role_id, source
    FROM alliance_memberships
    WHERE hq_user_id = ${hqUserId}
      AND alliance_id = ${allianceId}
      AND status = 'active'
    LIMIT 1
  `;

  if (!membership || membership.source !== "manual") {
    return false;
  }

  const [currentRole] = await sql<{ name: string }[]>`
    SELECT name
    FROM roles
    WHERE id = ${membership.role_id}
    LIMIT 1
  `;

  const currentRoleName = currentRole?.name;
  if (
    !currentRoleName ||
    !shouldUpgradeSystemRole(
      currentRoleName as keyof typeof ROLE_IDS,
      nextRoleName,
    )
  ) {
    return false;
  }

  const now = new Date();
  await sql`
    UPDATE alliance_memberships
    SET role_id = ${ROLE_IDS[nextRoleName]}, updated_at = ${now}
    WHERE id = ${membership.id}
  `;

  return true;
}
