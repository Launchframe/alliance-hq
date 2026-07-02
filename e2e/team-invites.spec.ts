import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  clearAllianceGameServerLink,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
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
});
