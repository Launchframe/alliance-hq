import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authCookieHeader,
  clearAllianceGameServerLink,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

function hqSessionOnlyCookie(sessionId: string): string {
  return `alliance_hq_session=${sessionId}`;
}

function parseAllianceHqSessionId(
  setCookieHeader: string | string[] | undefined,
): string {
  const parts = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const part of parts) {
    const match = part.match(/alliance_hq_session=([^;]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error("Missing alliance_hq_session in Set-Cookie");
}

async function mintSessionViaBootstrap(
  request: APIRequestContext,
): Promise<string> {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", {
    maxRedirects: 0,
  });
  expect(bootstrap.status(), await bootstrap.text()).toBeGreaterThanOrEqual(300);
  expect(bootstrap.status()).toBeLessThan(400);
  return parseAllianceHqSessionId(bootstrap.headers()["set-cookie"]);
}

test.describe("Team Access — officer invites", () => {
  test("officer can create member invite via team API", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TI${nanoid(3)}`,
      name: "Team Invite Alliance",
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        kind: "protected_link",
        roleName: "member",
      },
    });

    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { invite?: { inviteUrl: string } };
    expect(body.invite?.inviteUrl).toContain("/invite/");
  });

  test("officer can create officer invite with R4 claim target", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TR${nanoid(3)}`,
      name: "Team Invite R4 Hybrid Alliance",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "R4 Hybrid Commander",
      allianceRank: 4,
      allianceRankTitle: "Warlord",
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-r4"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        kind: "protected_link",
        roleName: "officer",
        targetAshedMemberId: ashedMemberId,
      },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok?: boolean; invite?: { inviteUrl?: string } };
    expect(body.ok).toBe(true);
    expect(body.invite?.inviteUrl).toContain("/invite/");
  });

  test("officer can create owner invite with R5 claim target", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TO${nanoid(3)}`,
      name: "Team Invite R5 Hybrid Alliance",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "R5 Hybrid Commander",
      allianceRank: 5,
      allianceRankTitle: "Leader",
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-r5"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        kind: "protected_link",
        roleName: "owner",
        targetAshedMemberId: ashedMemberId,
      },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok?: boolean; invite?: { inviteUrl?: string } };
    expect(body.ok).toBe(true);
    expect(body.invite?.inviteUrl).toContain("/invite/");
  });

  test("officer cannot assign owner role without R5 claim target", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TW${nanoid(3)}`,
      name: "Team Invite Owner Block Alliance",
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-owner-block"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        kind: "protected_link",
        roleName: "owner",
      },
    });

    expect(res.status()).toBe(403);
  });

  test("officer cannot assign officer role via team API", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TB${nanoid(3)}`,
      name: "Team Invite Block Alliance",
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-block"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        kind: "protected_link",
        roleName: "officer",
      },
    });

    expect(res.status()).toBe(403);
  });

  test("officer invite API succeeds when alliance has no linked game server", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TS${nanoid(3)}`,
      name: "Team Invite No Server Alliance",
    });
    await clearAllianceGameServerLink(sql, alliance.allianceId);
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-no-server"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        kind: "protected_link",
        roleName: "member",
      },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      invite?: { inviteUrl?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.invite?.inviteUrl).toBeTruthy();
  });

  test("officer join-code API succeeds when alliance has no linked game server", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TJ${nanoid(3)}`,
      name: "Team Join Code No Server Alliance",
    });
    await clearAllianceGameServerLink(sql, alliance.allianceId);
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-join-no-server"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/join-codes", {
      headers: {
        Cookie: authCookieHeader(officer),
      },
      data: {
        roleName: "member",
        maxRedemptions: 5,
      },
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok?: boolean; joinCode?: { code?: string } };
    expect(body.ok).toBe(true);
    expect(body.joinCode?.code).toBeTruthy();
  });

  test("member cannot access team invite API", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TM${nanoid(3)}`,
      name: "Team Invite Member Alliance",
    });
    const member = await createAuthenticatedHqSession(sql, uniqueEmail("member-block"));
    await createAllianceMembership(sql, {
      hqUserId: member.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${member.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: {
        Cookie: authCookieHeader(member),
      },
      data: {
        kind: "protected_link",
        roleName: "member",
      },
    });

    expect(res.status()).toBe(403);
  });

  test("owner can demote officer to member; officer cannot demote", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TD${nanoid(3)}`,
      name: "Team Demote Alliance",
    });
    const owner = await createAuthenticatedHqSession(sql, uniqueEmail("owner-demote"));
    const officer = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("officer-demote"),
    );
    const otherOfficer = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("officer-keep"),
    );

    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createAllianceMembership(sql, {
      hqUserId: otherOfficer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });

    const [officerMembership] = await sql`
      SELECT id
      FROM alliance_memberships
      WHERE hq_user_id = ${officer.hqUserId}
        AND alliance_id = ${alliance.allianceId}
      LIMIT 1
    `;
    expect(officerMembership?.id).toBeTruthy();

    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const officerDenied = await request.post(
      `/api/settings/team/memberships/${officerMembership.id}/role`,
      {
        headers: { Cookie: authCookieHeader(officer) },
        data: { roleName: "member" },
      },
    );
    expect(officerDenied.status()).toBe(403);

    const ownerOk = await request.post(
      `/api/settings/team/memberships/${officerMembership.id}/role`,
      {
        headers: { Cookie: authCookieHeader(owner) },
        data: { roleName: "member" },
      },
    );
    expect(ownerOk.status()).toBe(200);
    const body = (await ownerOk.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);

    const rows = await sql`
      SELECT r.name AS role_name, m.source
      FROM alliance_memberships m
      INNER JOIN roles r ON r.id = m.role_id
      WHERE m.id = ${officerMembership.id}
    `;
    expect(rows[0]?.role_name).toBe("member");
    expect(rows[0]?.source).toBe("manual");
  });

  test("bootstrap session cannot demote officer membership role", async ({
    request,
  }) => {
    const sessionId = await mintSessionViaBootstrap(request);
    const res = await request.post(
      "/api/settings/team/memberships/not-a-real-id/role",
      {
        headers: { Cookie: hqSessionOnlyCookie(sessionId) },
        data: { roleName: "member" },
      },
    );
    expect(res.status()).toBe(403);
  });

  test("member cannot demote officer membership role", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TM${nanoid(3)}`,
      name: "Team Role Member Block Alliance",
    });
    const member = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("member-role-block"),
    );
    await createAllianceMembership(sql, {
      hqUserId: member.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${member.sessionId}
    `;

    const res = await request.post(
      "/api/settings/team/memberships/not-a-real-id/role",
      {
        headers: { Cookie: authCookieHeader(member) },
        data: { roleName: "member" },
      },
    );
    expect(res.status()).toBe(403);
  });
});
