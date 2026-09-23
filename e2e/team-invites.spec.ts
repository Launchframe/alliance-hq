import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authCookieHeader,
  clearAllianceGameServerLink,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
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

  test("owner can elevate member to officer and the action is audited", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TE${nanoid(3)}`,
      name: "Team Elevate Alliance",
    });
    const owner = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("owner-elevate-manual"),
    );
    const member = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("member-elevate-manual"),
    );
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await createAllianceMembership(sql, {
      hqUserId: member.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const [membership] = await sql`
      SELECT id FROM alliance_memberships
      WHERE hq_user_id = ${member.hqUserId}
        AND alliance_id = ${alliance.allianceId}
        AND status = 'active'
      LIMIT 1
    `;
    expect(membership?.id).toBeTruthy();
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;

    const res = await request.post(
      `/api/settings/team/memberships/${membership.id}/role`,
      {
        headers: { Cookie: authCookieHeader(owner) },
        data: { roleName: "officer" },
      },
    );
    expect(res.status()).toBe(200);

    const [updated] = await sql`
      SELECT r.name AS role_name
      FROM alliance_memberships m
      INNER JOIN roles r ON r.id = m.role_id
      WHERE m.id = ${membership.id}
    `;
    expect(updated?.role_name).toBe("officer");

    const auditRows = await sql`
      SELECT action, resource_type, resource_id, hq_user_id
      FROM audit_log
      WHERE alliance_id = ${alliance.allianceId}
        AND action = 'team.role_nudge_elevate'
        AND resource_type = 'alliance_membership'
        AND resource_id = ${membership.id}
    `;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.hq_user_id).toBe(owner.hqUserId);
  });
});

test.describe("Team Access — R4 privilege nudges", () => {
  async function seedOfficerSession(
    sql: ReturnType<typeof getE2eSql>,
    allianceId: string,
    tag: string,
    emailPrefix: string,
  ) {
    const officer = await createAuthenticatedHqSession(
      sql,
      uniqueEmail(emailPrefix),
    );
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${allianceId}, alliance_tag = ${tag}
      WHERE id = ${officer.sessionId}
    `;
    return officer;
  }

  async function seedOpenNudge(
    sql: ReturnType<typeof getE2eSql>,
    input: {
      allianceId: string;
      ashedMemberId: string;
      hqUserId?: string | null;
      kind: "escalate_invite" | "escalate_elevate" | "deescalate";
      fromRank?: number | null;
      toRank?: number | null;
      rankEventId?: string | null;
      status?: string;
    },
  ): Promise<string> {
    const nudgeId = nanoid(16);
    await sql`
      INSERT INTO member_role_nudges (
        id, alliance_id, ashed_member_id, hq_user_id, kind,
        from_rank, to_rank, rank_event_id, status
      ) VALUES (
        ${nudgeId},
        ${input.allianceId},
        ${input.ashedMemberId},
        ${input.hqUserId ?? null},
        ${input.kind},
        ${input.fromRank ?? null},
        ${input.toRank ?? null},
        ${input.rankEventId ?? null},
        ${input.status ?? "open"}
      )
    `;
    return nudgeId;
  }

  async function postNudgeAction(
    request: APIRequestContext,
    nudgeId: string,
    action: "accept" | "reject",
    cookie: string,
  ) {
    return request.post(
      `/api/settings/team/role-nudges/${nudgeId}/${action}`,
      { headers: { Cookie: cookie } },
    );
  }

  test("bootstrap-only session gets 403 for accept and reject", async ({
    request,
  }) => {
    const sessionId = await mintSessionViaBootstrap(request);
    const cookie = hqSessionOnlyCookie(sessionId);
    const accept = await postNudgeAction(request, "missing", "accept", cookie);
    const reject = await postNudgeAction(request, "missing", "reject", cookie);
    expect(accept.status()).toBe(403);
    expect(reject.status()).toBe(403);
  });

  test("member gets 403 for accept and reject", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NM${nanoid(3)}`,
      name: "Nudge Member Block Alliance",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Nudge Target",
      allianceRank: 4,
    });
    const nudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      kind: "escalate_invite",
      fromRank: 3,
      toRank: 4,
    });
    const member = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("member-nudge"),
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
    const cookie = authCookieHeader(member);
    const accept = await postNudgeAction(request, nudgeId, "accept", cookie);
    const reject = await postNudgeAction(request, nudgeId, "reject", cookie);
    expect(accept.status()).toBe(403);
    expect(reject.status()).toBe(403);
  });

  test("officer gets 403 accepting an owner-only deescalate when an HQ owner exists", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NO${nanoid(3)}`,
      name: "Nudge Owner Gate Alliance",
    });
    const owner = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("owner-nudge"),
    );
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE alliances SET owner_hq_user_id = ${owner.hqUserId}
      WHERE id = ${alliance.allianceId}
    `;
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-nudge",
    );
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Demote Target",
      allianceRank: 2,
    });
    const nudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      kind: "deescalate",
      fromRank: 4,
      toRank: 2,
    });

    const res = await postNudgeAction(
      request,
      nudgeId,
      "accept",
      authCookieHeader(officer),
    );
    expect(res.status()).toBe(403);

    const list = await request.get("/api/settings/team/role-nudges", {
      headers: { Cookie: authCookieHeader(officer) },
    });
    expect(list.status()).toBe(200);
    const { open } = (await list.json()) as {
      open: Array<{ id: string; canAct: boolean }>;
    };
    const entry = open.find((item) => item.id === nudgeId);
    expect(entry).toBeDefined();
    expect(entry?.canAct).toBe(false);
  });

  test("officer cannot accept a stale escalate after target is no longer R4", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NS${nanoid(3)}`,
      name: "Nudge Stale Alliance",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Stale Target",
      allianceRank: 4,
    });
    const nudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      kind: "escalate_invite",
      fromRank: 3,
      toRank: 4,
    });
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-stale",
    );

    await sql`
      UPDATE alliance_members SET alliance_rank = 2
      WHERE alliance_id = ${alliance.allianceId}
        AND ashed_member_id = ${ashedMemberId}
    `;

    const res = await postNudgeAction(
      request,
      nudgeId,
      "accept",
      authCookieHeader(officer),
    );
    expect(res.status()).toBe(409);

    const [nudge] = await sql`
      SELECT status FROM member_role_nudges WHERE id = ${nudgeId}
    `;
    expect(nudge?.status).toBe("superseded");
    const invites = await sql`
      SELECT id FROM hq_invites
      WHERE alliance_id = ${alliance.allianceId}
        AND target_ashed_member_id = ${ashedMemberId}
    `;
    expect(invites).toHaveLength(0);
  });

  test("stale elevate targeting an owner cannot overwrite the role", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NE${nanoid(3)}`,
      name: "Nudge Owner Elevate Alliance",
    });
    const owner = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("owner-elevate"),
    );
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Owner Target",
      allianceRank: 4,
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: owner.hqUserId,
      ashedMemberId,
    });
    const nudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      hqUserId: owner.hqUserId,
      kind: "escalate_elevate",
      fromRank: 3,
      toRank: 4,
    });
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-elevate",
    );

    const res = await postNudgeAction(
      request,
      nudgeId,
      "accept",
      authCookieHeader(officer),
    );
    expect(res.status()).toBe(409);

    const [membership] = await sql`
      SELECT r.name AS role_name
      FROM alliance_memberships m
      INNER JOIN roles r ON r.id = m.role_id
      WHERE m.alliance_id = ${alliance.allianceId}
        AND m.hq_user_id = ${owner.hqUserId}
        AND m.status = 'active'
    `;
    expect(membership?.role_name).toBe("owner");
    const [nudge] = await sql`
      SELECT status FROM member_role_nudges WHERE id = ${nudgeId}
    `;
    expect(nudge?.status).toBe("superseded");
  });

  test("permitted accept and reject controls succeed", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NP${nanoid(3)}`,
      name: "Nudge Positive Alliance",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Accept Target",
      allianceRank: 4,
    });
    const { ashedMemberId: rejectMemberId } = await createAllianceRosterMember(
      sql,
      {
        allianceId: alliance.allianceId,
        currentName: "Reject Target",
        allianceRank: 4,
      },
    );
    const acceptNudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      kind: "escalate_invite",
      fromRank: 3,
      toRank: 4,
    });
    const rejectNudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: rejectMemberId,
      kind: "escalate_invite",
      fromRank: 3,
      toRank: 4,
    });
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-positive",
    );
    const cookie = authCookieHeader(officer);

    const accept = await postNudgeAction(
      request,
      acceptNudgeId,
      "accept",
      cookie,
    );
    expect(accept.status()).toBe(200);
    const reject = await postNudgeAction(
      request,
      rejectNudgeId,
      "reject",
      cookie,
    );
    expect(reject.status()).toBe(200);

    const rows = await sql`
      SELECT id, status FROM member_role_nudges
      WHERE id IN (${acceptNudgeId}, ${rejectNudgeId})
      ORDER BY id
    `;
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(acceptNudgeId)).toBe("accepted");
    expect(byId.get(rejectNudgeId)).toBe("rejected");

    const auditRows = await sql`
      SELECT action, resource_id, hq_user_id
      FROM audit_log
      WHERE alliance_id = ${alliance.allianceId}
        AND resource_type = 'member_role_nudge'
        AND resource_id IN (${acceptNudgeId}, ${rejectNudgeId})
      ORDER BY action
    `;
    expect(auditRows).toHaveLength(2);
    expect(auditRows).toEqual([
      {
        action: "team.role_nudge_accept",
        resource_id: acceptNudgeId,
        hq_user_id: officer.hqUserId,
      },
      {
        action: "team.role_nudge_reject",
        resource_id: rejectNudgeId,
        hq_user_id: officer.hqUserId,
      },
    ]);
  });

  test("concurrent accepts create at most one invite and one success", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NC${nanoid(3)}`,
      name: "Nudge Concurrent Alliance",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Concurrent Target",
      allianceRank: 4,
    });
    const nudgeId = await seedOpenNudge(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      kind: "escalate_invite",
      fromRank: 3,
      toRank: 4,
    });
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-concurrent",
    );
    const cookie = authCookieHeader(officer);

    const [first, second] = await Promise.all([
      postNudgeAction(request, nudgeId, "accept", cookie),
      postNudgeAction(request, nudgeId, "accept", cookie),
    ]);
    const statuses = [first.status(), second.status()].sort();
    expect(statuses).toEqual([200, 409]);

    const invites = await sql`
      SELECT id FROM hq_invites
      WHERE alliance_id = ${alliance.allianceId}
        AND target_ashed_member_id = ${ashedMemberId}
    `;
    expect(invites.length).toBeLessThanOrEqual(1);
  });

  test("reject then R4→R3→R4 reopens a fresh escalation and opposite crossings supersede stale opens", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NR${nanoid(3)}`,
      name: "Nudge Reentry Alliance",
    });
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-reentry",
    );
    const cookie = authCookieHeader(officer);

    const target = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("linked-target"),
    );
    await createAllianceMembership(sql, {
      hqUserId: target.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Reentry Target",
      allianceRank: 3,
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: target.hqUserId,
      ashedMemberId,
    });

    const setRank = async (rank: number) =>
      request.post("/api/trains/member-ranks", {
        headers: { Cookie: cookie },
        data: { ashedMemberId, memberName: "Reentry Target", allianceRank: rank },
      });

    expect((await setRank(4)).status()).toBe(200);
    let nudges = await sql`
      SELECT id, status FROM member_role_nudges
      WHERE alliance_id = ${alliance.allianceId}
        AND ashed_member_id = ${ashedMemberId}
        AND kind = 'escalate_elevate'
    `;
    expect(nudges).toHaveLength(1);
    expect(nudges[0]?.status).toBe("open");
    const firstNudgeId = String(nudges[0]?.id);

    const reject = await postNudgeAction(
      request,
      firstNudgeId,
      "reject",
      cookie,
    );
    expect(reject.status()).toBe(200);

    expect((await setRank(3)).status()).toBe(200);
    expect((await setRank(4)).status()).toBe(200);

    nudges = await sql`
      SELECT id, status FROM member_role_nudges
      WHERE alliance_id = ${alliance.allianceId}
        AND ashed_member_id = ${ashedMemberId}
        AND kind = 'escalate_elevate'
      ORDER BY created_at
    `;
    expect(nudges).toHaveLength(2);
    expect(nudges[0]?.status).toBe("rejected");
    expect(nudges[1]?.status).toBe("open");
    expect(String(nudges[1]?.id)).not.toBe(firstNudgeId);

    const reopenedId = String(nudges[1]?.id);
    expect((await setRank(3)).status()).toBe(200);

    const [reopened] = await sql`
      SELECT status FROM member_role_nudges WHERE id = ${reopenedId}
    `;
    expect(reopened?.status).toBe("superseded");
    const deescalates = await sql`
      SELECT id FROM member_role_nudges
      WHERE alliance_id = ${alliance.allianceId}
        AND ashed_member_id = ${ashedMemberId}
        AND kind = 'deescalate'
    `;
    expect(deescalates).toHaveLength(0);
  });

  test("rank clear and first-seen native R4 insert invoke the nudge lifecycle", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NL${nanoid(3)}`,
      name: "Nudge Lifecycle Alliance",
    });
    const officer = await seedOfficerSession(
      sql,
      alliance.allianceId,
      alliance.tag,
      "officer-lifecycle",
    );
    const cookie = authCookieHeader(officer);

    const demoteTarget = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("clear-target"),
    );
    await createAllianceMembership(sql, {
      hqUserId: demoteTarget.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    const { ashedMemberId: clearMemberId } = await createAllianceRosterMember(
      sql,
      {
        allianceId: alliance.allianceId,
        currentName: "Clear Target",
        allianceRank: 4,
      },
    );
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: demoteTarget.hqUserId,
      ashedMemberId: clearMemberId,
    });

    const clear = await request.post("/api/members/ranks", {
      headers: { Cookie: cookie },
      data: { memberIds: [clearMemberId], action: "clear" },
    });
    expect(clear.status()).toBe(200);

    const deescalates = await sql`
      SELECT id, status FROM member_role_nudges
      WHERE alliance_id = ${alliance.allianceId}
        AND ashed_member_id = ${clearMemberId}
        AND kind = 'deescalate'
    `;
    expect(deescalates).toHaveLength(1);
    expect(deescalates[0]?.status).toBe("open");

    const commit = await request.post("/api/members/roster-import/commit", {
      headers: { Cookie: cookie },
      data: {
        rows: [
          {
            extractedName: "First Seen R4",
            matchMemberId: null,
            allianceRank: 4,
          },
        ],
      },
    });
    expect(commit.status()).toBe(200);

    const escalates = await sql`
      SELECT n.id, n.status, n.kind
      FROM member_role_nudges n
      INNER JOIN alliance_members m
        ON m.alliance_id = n.alliance_id
        AND m.ashed_member_id = n.ashed_member_id
      WHERE n.alliance_id = ${alliance.allianceId}
        AND m.current_name = 'First Seen R4'
    `;
    expect(escalates).toHaveLength(1);
    expect(escalates[0]?.status).toBe("open");
    expect(["escalate_invite", "escalate_elevate"]).toContain(
      escalates[0]?.kind,
    );
  });
});
