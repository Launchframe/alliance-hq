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
import {
  authCookieHeader,
  encodeNextAuthSessionToken,
  playwrightAuthCookies,
} from "./auth";
import { assertE2eDatabaseUrl } from "../../scripts/e2e-database-url-guard.mjs";

export { playwrightAuthCookies, authCookieHeader };

const SESSION_COOKIE = "alliance_hq_session";

export type Sql = ReturnType<typeof postgres>;

let e2eSqlSingleton: Sql | null = null;

export function getE2eSql(): Sql {
  const url =
    process.env.E2E_DATABASE_URL?.trim() ||
    process.env.LOCAL_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("E2E database URL is not configured.");
  }
  assertE2eDatabaseUrl(url);
  if (e2eSqlSingleton) {
    return e2eSqlSingleton;
  }
  e2eSqlSingleton = postgres(url, { max: 4, prepare: false });
  return e2eSqlSingleton;
}

export async function closeE2eSql(): Promise<void> {
  if (e2eSqlSingleton) {
    await e2eSqlSingleton.end({ timeout: 5 });
    e2eSqlSingleton = null;
  }
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Same SHA-256 digest as invite tokens; roster link action tokens use identical hashing. */
export const hashRosterLinkActionToken = hashInviteToken;

export function inviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export type SessionFixture = {
  sessionId: string;
  hqUserId: string;
  email: string;
  nextAuthToken: string;
};

export async function createPlatformMaintainerSession(
  sql: Sql,
): Promise<SessionFixture> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const sessionId = nanoid(32);
  const hqUserId = nanoid(16);
  // Store the email normalized (lowercase) so it matches what the auth guards
  // resolve via `ensureHqUserForAuthEmail` (NextAuth token email + Ashed email
  // normalization both lowercase). nanoid() can emit uppercase, so an
  // un-normalized address would never match and the session would be rebound
  // to a freshly-created non-maintainer user.
  const email = `maintainer-${nanoid(8)}@e2e.test`.toLowerCase();

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

  const nextAuthToken = await encodeNextAuthSessionToken({
    hqUserId,
    email,
    name: "E2E Maintainer",
  });

  return { sessionId, hqUserId, email, nextAuthToken };
}

export async function createNativeAlliance(
  sql: Sql,
  options: { tag: string; name: string; ownerHqUserId?: string | null },
): Promise<{ allianceId: string; tag: string }> {
  return createAllianceWithOperatingMode(sql, { ...options, operatingMode: "native" });
}

export async function createAshedAlliance(
  sql: Sql,
  options: { tag: string; name: string; ownerHqUserId?: string | null },
): Promise<{ allianceId: string; tag: string }> {
  return createAllianceWithOperatingMode(sql, { ...options, operatingMode: "ashed" });
}

async function createAllianceWithOperatingMode(
  sql: Sql,
  options: {
    tag: string;
    name: string;
    ownerHqUserId?: string | null;
    operatingMode: "native" | "ashed";
    gameServerNumber?: number;
  },
): Promise<{ allianceId: string; tag: string }> {
  const now = new Date();
  const allianceId = nanoid(16);
  const slug = `e2e-${options.tag.toLowerCase()}-${nanoid(4)}`;
  const serverNumber = options.gameServerNumber ?? 1203;
  const seasonId = "season-1";
  const gameServerId = `server-${serverNumber}`;

  await sql`
    INSERT INTO game_seasons (id, season_number, created_at, updated_at)
    VALUES (${seasonId}, 1, ${now}, ${now})
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO game_servers (
      id,
      server_number,
      season_id,
      season_key_synced,
      season_key_source,
      season_is_post_season,
      synced_at,
      created_at,
      updated_at
    ) VALUES (
      ${gameServerId},
      ${serverNumber},
      ${seasonId},
      '1',
      'default',
      0,
      ${now},
      ${now},
      ${now}
    )
    ON CONFLICT (server_number) DO NOTHING
  `;

  await sql`
    INSERT INTO alliances (
      id, slug, tag, name, operating_mode, owner_hq_user_id, game_server_number, game_server_id, created_at, updated_at
    ) VALUES (
      ${allianceId},
      ${slug},
      ${options.tag},
      ${options.name},
      ${options.operatingMode},
      ${options.ownerHqUserId ?? null},
      ${serverNumber},
      ${gameServerId},
      ${now},
      ${now}
    )
  `;

  return { allianceId, tag: options.tag };
}

/**
 * Clears alliances.game_server_id while keeping game_server_number (denormalized).
 * Matches resolveAllianceGameServerNumber() returning null — invites no longer require a link.
 */
export async function clearAllianceGameServerLink(
  sql: Sql,
  allianceId: string,
): Promise<void> {
  await sql`ALTER TABLE alliances ALTER COLUMN game_server_id DROP NOT NULL`;
  await sql`
    UPDATE alliances
    SET game_server_id = NULL
    WHERE id = ${allianceId}
  `;
}

/** Links a native alliance to the canonical game_servers row. */
export async function linkNativeAllianceToGameServer(
  sql: Sql,
  allianceId: string,
  serverNumber = 1203,
): Promise<void> {
  const now = new Date();
  const seasonId = "season-1";
  const gameServerId = `server-${serverNumber}`;

  await sql`
    INSERT INTO game_seasons (id, season_number, created_at, updated_at)
    VALUES (${seasonId}, 1, ${now}, ${now})
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO game_servers (
      id,
      server_number,
      season_id,
      season_key_synced,
      season_key_source,
      season_is_post_season,
      synced_at,
      created_at,
      updated_at
    ) VALUES (
      ${gameServerId},
      ${serverNumber},
      ${seasonId},
      '1',
      'default',
      0,
      ${now},
      ${now},
      ${now}
    )
    ON CONFLICT (server_number) DO NOTHING
  `;

  await sql`
    UPDATE alliances
    SET game_server_id = ${gameServerId},
        game_server_number = ${serverNumber},
        updated_at = ${now}
    WHERE id = ${allianceId}
  `;
}

export async function createHqInviteRow(
  sql: Sql,
  input: {
    allianceId: string;
    email: string;
    roleName: keyof typeof ROLE_IDS;
    redirectPath?: string | null;
    invitedByHqUserId?: string | null;
    targetAshedMemberId?: string | null;
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
      target_ashed_member_id,
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
      ${input.targetAshedMemberId ?? null},
      ${now}
    )
  `;

  return { token, inviteId };
}

export async function acceptInviteViaApi(
  sql: Sql,
  baseURL: string,
  token: string,
  email: string,
  next?: string,
  sessionId?: string,
  passphrase?: string,
): Promise<{
  sessionId: string;
  redirectTo: string;
  hqUserId: string;
  nextAuthToken: string;
}> {
  let browserSessionId = sessionId;
  let nextAuthToken: string | undefined;

  if (!browserSessionId) {
    const fixture = await createAuthenticatedHqSession(sql, email);
    browserSessionId = fixture.sessionId;
    nextAuthToken = fixture.nextAuthToken;
  } else if (!nextAuthToken) {
    const [sessionRow] = await sql<
      Array<{
        hqUserId: string;
        email: string;
        displayName: string | null;
      }>
    >`
      SELECT s.hq_user_id AS "hqUserId", u.email, u.display_name AS "displayName"
      FROM sessions s
      INNER JOIN hq_users u ON u.id = s.hq_user_id
      WHERE s.id = ${browserSessionId}
      LIMIT 1
    `;

    if (sessionRow?.hqUserId) {
      nextAuthToken = await encodeNextAuthSessionToken({
        hqUserId: sessionRow.hqUserId,
        email: sessionRow.email,
        name: sessionRow.displayName ?? "E2E User",
      });
    } else {
      const authUser = await createHqUserOnly(sql, email);
      nextAuthToken = authUser.nextAuthToken;
    }
  }

  const res = await fetch(`${baseURL}/api/invite/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: authCookieHeader({
        sessionId: browserSessionId,
        nextAuthToken,
      }),
    },
    body: JSON.stringify({
      email,
      displayName: "E2E User",
      next,
      passphrase,
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

  const hqUserId = body.hqUserId ?? "";
  nextAuthToken = await encodeNextAuthSessionToken({
    hqUserId,
    email: email.toLowerCase(),
    name: "E2E User",
  });

  return {
    sessionId: browserSessionId,
    hqUserId,
    nextAuthToken,
    redirectTo: body.redirectTo ?? "/onboard",
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
  const explicitAshedUserId = Boolean(options && "ashedUserId" in options);
  let ashedUserId = explicitAshedUserId ? (options?.ashedUserId ?? null) : null;

  const [sessionRow] = await sql<{ hq_user_id: string | null }[]>`
    SELECT hq_user_id FROM sessions WHERE id = ${sessionId} LIMIT 1
  `;

  if (sessionRow?.hq_user_id && !explicitAshedUserId) {
    const [userRow] = await sql<{ ashed_user_id: string | null }[]>`
      SELECT ashed_user_id FROM hq_users WHERE id = ${sessionRow.hq_user_id} LIMIT 1
    `;
    ashedUserId =
      userRow?.ashed_user_id?.trim() || `ashed-e2e-${nanoid(12)}`;

    if (!userRow?.ashed_user_id?.trim()) {
      await sql`
        UPDATE hq_users
        SET ashed_user_id = ${ashedUserId}, updated_at = ${now}
        WHERE id = ${sessionRow.hq_user_id}
      `;
    }
  }

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
      ${ashedUserId},
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

  const nextAuthToken = await encodeNextAuthSessionToken({
    hqUserId,
    email: normalizedEmail,
    name: displayName,
  });

  return {
    sessionId,
    hqUserId,
    email: normalizedEmail,
    nextAuthToken,
  };
}

export async function createMagicLinkSession(
  sql: Sql,
  email: string,
): Promise<SessionFixture> {
  return createAuthenticatedHqSession(sql, email);
}

/** HQ user + NextAuth token without creating a new browser session row. */
export async function createHqUserOnly(
  sql: Sql,
  email: string,
  options?: { displayName?: string; accessGranted?: boolean },
): Promise<{ hqUserId: string; email: string; nextAuthToken: string }> {
  const now = new Date();
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

  const nextAuthToken = await encodeNextAuthSessionToken({
    hqUserId,
    email: normalizedEmail,
    name: displayName,
  });

  return { hqUserId, email: normalizedEmail, nextAuthToken };
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

/** Seeds hq_member_links so invited members can pass the app shell gate in e2e. */
export async function createHqMemberLink(
  sql: Sql,
  input: {
    allianceId: string;
    hqUserId: string;
    ashedMemberId?: string;
    gameUid?: string;
    memberDisplayName?: string;
  },
): Promise<{ ashedMemberId: string; gameUid: string }> {
  const now = new Date();
  const id = nanoid(16);
  const ashedMemberId = input.ashedMemberId ?? `e2e-member-${nanoid(12)}`;
  const gameUid = input.gameUid ?? `12345678901203`;
  const memberDisplayName = input.memberDisplayName ?? "E2E Commander";

  await sql`
    INSERT INTO hq_member_links (
      id, alliance_id, hq_user_id, ashed_member_id, member_display_name, game_uid, linked_at, updated_at
    ) VALUES (
      ${id},
      ${input.allianceId},
      ${input.hqUserId},
      ${ashedMemberId},
      ${memberDisplayName},
      ${gameUid},
      ${now},
      ${now}
    )
    ON CONFLICT (alliance_id, hq_user_id) DO UPDATE SET
      ashed_member_id = EXCLUDED.ashed_member_id,
      member_display_name = EXCLUDED.member_display_name,
      game_uid = EXCLUDED.game_uid,
      updated_at = EXCLUDED.updated_at
  `;

  return { ashedMemberId, gameUid };
}

export async function createAllianceRosterMember(
  sql: Sql,
  input: {
    allianceId: string;
    currentName: string;
    ashedMemberId?: string;
    status?: string;
  },
): Promise<{ ashedMemberId: string }> {
  const now = new Date();
  const ashedMemberId = input.ashedMemberId ?? `e2e-roster-${nanoid(12)}`;
  await sql`
    INSERT INTO alliance_members (
      id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
      previous_names_json, status, synced_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${input.allianceId},
      ${ashedMemberId},
      ${`native-roster:${input.allianceId}`},
      ${input.currentName},
      ${sql.json([])},
      ${input.status ?? "active"},
      ${now},
      ${now},
      ${now}
    )
    ON CONFLICT (alliance_id, ashed_member_id) DO UPDATE SET
      current_name = EXCLUDED.current_name,
      status = EXCLUDED.status,
      synced_at = EXCLUDED.synced_at,
      updated_at = EXCLUDED.updated_at
  `;
  return { ashedMemberId };
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

function normalizeJoinCodeForE2e(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function hashJoinCodeForE2e(code: string): string {
  const normalized = normalizeJoinCodeForE2e(code);
  return createHash("sha256").update(normalized).digest("hex");
}

/** Match production join codes (A-Z0-9 + hyphen). Avoid nanoid `_`, which SegmentedCodeInput strips. */
function generateE2eJoinCode(): string {
  return `E2E-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createAllianceJoinCodeRow(
  sql: Sql,
  options: {
    allianceId: string;
    roleName: keyof typeof ROLE_IDS;
    code?: string;
    maxRedemptions?: number;
    createdByHqUserId?: string | null;
    expiresInDays?: number;
  },
): Promise<{ joinCodeId: string; code: string }> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (options.expiresInDays ?? 7) * 24 * 60 * 60 * 1000,
  );
  const joinCodeId = nanoid(16);
  const code = normalizeJoinCodeForE2e(options.code ?? generateE2eJoinCode());
  const codeHash = hashJoinCodeForE2e(code);
  const codeHint =
    code.length <= 4 ? code : `…${code.slice(-4)}`;
  const roleId = ROLE_IDS[options.roleName];

  await sql`
    INSERT INTO hq_alliance_join_codes (
      id,
      alliance_id,
      role_id,
      code_hash,
      code_hint,
      max_redemptions,
      redemption_count,
      expires_at,
      created_by_hq_user_id,
      created_at
    ) VALUES (
      ${joinCodeId},
      ${options.allianceId},
      ${roleId},
      ${codeHash},
      ${codeHint},
      ${options.maxRedemptions ?? 10},
      0,
      ${expiresAt},
      ${options.createdByHqUserId ?? null},
      ${now}
    )
  `;

  return { joinCodeId, code };
}

export type BrowserSessionAllianceContext = {
  hqUserId: string | null;
  allianceId: string | null;
  allianceTag: string | null;
  currentAllianceId: string | null;
};

export async function loadBrowserSessionAllianceContext(
  sql: Sql,
  sessionId: string,
): Promise<BrowserSessionAllianceContext | null> {
  const [row] = await sql<
    {
      hq_user_id: string | null;
      alliance_id: string | null;
      alliance_tag: string | null;
      current_alliance_id: string | null;
    }[]
  >`
    SELECT hq_user_id, alliance_id, alliance_tag, current_alliance_id
    FROM sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;

  if (!row) {
    return null;
  }

  return {
    hqUserId: row.hq_user_id,
    allianceId: row.alliance_id,
    allianceTag: row.alliance_tag,
    currentAllianceId: row.current_alliance_id,
  };
}

export async function getLatestPendingRosterLinkRequestId(
  sql: Sql,
  input: { allianceId: string; hqUserId: string },
): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id
    FROM hq_roster_link_requests
    WHERE alliance_id = ${input.allianceId}
      AND hq_user_id = ${input.hqUserId}
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return row?.id ?? null;
}

export async function insertRosterLinkAcceptToken(
  sql: Sql,
  input: { requestId: string; rawToken?: string },
): Promise<string> {
  const rawToken = input.rawToken ?? randomBytes(32).toString("base64url");
  const tokenHash = hashRosterLinkActionToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  await sql`
    INSERT INTO hq_roster_link_action_tokens (
      id,
      request_id,
      action,
      token_hash,
      expires_at,
      created_at
    ) VALUES (
      ${nanoid(16)},
      ${input.requestId},
      'accept',
      ${tokenHash},
      ${expiresAt},
      ${now}
    )
  `;

  return rawToken;
}

export async function loadAllianceGameServerNumber(
  sql: Sql,
  allianceId: string,
): Promise<number | null> {
  const [row] = await sql<{ game_server_number: number | null }[]>`
    SELECT game_server_number
    FROM alliances
    WHERE id = ${allianceId}
    LIMIT 1
  `;
  return row?.game_server_number ?? null;
}

export async function createHqDiscordOAuthAccount(
  sql: Sql,
  input: {
    hqUserId: string;
    discordUserId: string;
    providerEmail?: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO hq_auth_accounts (
      id, hq_user_id, type, provider, provider_account_id, provider_email
    ) VALUES (
      ${nanoid(16)},
      ${input.hqUserId},
      ${"oauth"},
      ${"discord"},
      ${input.discordUserId},
      ${input.providerEmail ?? null}
    )
  `;
}

export async function createDiscordUserLinkNonce(
  sql: Sql,
  input: { discordUserId: string; guildId?: string | null; nonce?: string },
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const nonce = input.nonce ?? randomBytes(24).toString("hex");

  await sql`
    INSERT INTO discord_auth_nonces (
      id,
      nonce,
      discord_user_id,
      guild_id,
      tag,
      purpose,
      expires_at,
      created_at
    ) VALUES (
      ${nanoid(16)},
      ${nonce},
      ${input.discordUserId},
      ${input.guildId ?? null},
      ${"_user_link"},
      ${"user_link"},
      ${expiresAt},
      ${now}
    )
  `;

  return nonce;
}

export async function loadDiscordHqLink(
  sql: Sql,
  discordUserId: string,
): Promise<{ hqUserId: string } | null> {
  const [row] = await sql<{ hq_user_id: string }[]>`
    SELECT hq_user_id
    FROM discord_hq_links
    WHERE discord_user_id = ${discordUserId}
    LIMIT 1
  `;
  return row ? { hqUserId: row.hq_user_id } : null;
}

export async function createDiscordHqLink(
  sql: Sql,
  input: { hqUserId: string; discordUserId: string },
): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO discord_hq_links (discord_user_id, hq_user_id, linked_at)
    VALUES (${input.discordUserId}, ${input.hqUserId}, ${now})
    ON CONFLICT (discord_user_id) DO UPDATE
    SET hq_user_id = EXCLUDED.hq_user_id, linked_at = EXCLUDED.linked_at
  `;
}
