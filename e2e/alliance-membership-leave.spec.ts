import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  attachAshedConnectionToSession,
  authCookieHeader,
  createAllianceMembership,
  createAshedAlliance,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

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
    if (match?.[1]) return match[1];
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

test.describe("Alliance membership leave and missing Ashed credentials", () => {
  test("bootstrap session cannot remove an alliance membership", async ({
    request,
  }) => {
    const sessionId = await mintSessionViaBootstrap(request);
    const patch = await request.patch("/api/admin/users", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
      data: {
        hqUserId: "missing-user",
        removeMembership: { membershipId: "missing-membership" },
      },
    });
    expect(patch.status(), await patch.text()).toBe(403);
  });

  test("a member cannot remove a membership through the admin route", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const member = await createAuthenticatedHqSession(
      sql,
      `leave-member-${nanoid(6)}@e2e.test`,
    );
    const patch = await request.patch("/api/admin/users", {
      headers: { Cookie: authCookieHeader(member) },
      data: {
        hqUserId: member.hqUserId,
        removeMembership: { membershipId: "not-a-membership" },
      },
    });
    expect(patch.status(), await patch.text()).toBe(403);
  });

  test("a platform maintainer can remove a non-owner membership without unlinking the commander", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const suffix = nanoid(6);
    const maintainer = await createPlatformMaintainerSession(sql);
    const member = await createAuthenticatedHqSession(
      sql,
      `leave-target-${suffix}@e2e.test`,
    );
    const alliance = await createAshedAlliance(sql, {
      tag: `Lv${suffix}`.slice(0, 8),
      name: `Leave ${suffix}`,
    });
    await createAllianceMembership(sql, {
      hqUserId: member.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    const link = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: member.hqUserId,
      memberDisplayName: "Leave Target",
    });
    const [membership] = await sql<{ id: string }[]>`
      SELECT id FROM alliance_memberships
      WHERE hq_user_id = ${member.hqUserId}
        AND alliance_id = ${alliance.allianceId}
    `;
    expect(membership?.id).toBeTruthy();

    const patch = await request.patch("/api/admin/users", {
      headers: { Cookie: authCookieHeader(maintainer) },
      data: {
        hqUserId: member.hqUserId,
        removeMembership: { membershipId: membership!.id },
      },
    });
    expect(patch.status(), await patch.text()).toBe(200);

    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM alliance_memberships WHERE id = ${membership!.id}
    `;
    expect(row?.status).toBe("revoked");
    const [stillLinked] = await sql<{ id: string }[]>`
      SELECT id FROM hq_member_links
      WHERE hq_user_id = ${member.hqUserId}
        AND alliance_id = ${alliance.allianceId}
        AND game_uid = ${link.gameUid}
    `;
    expect(stillLinked?.id).toBeTruthy();
  });

  test("an officer with session Ashed sees the missing-credential banner", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const suffix = nanoid(6);
    const officer = await createAuthenticatedHqSession(
      sql,
      `cred-banner-${suffix}@e2e.test`,
    );
    const alliance = await createAshedAlliance(sql, {
      tag: `Cb${suffix}`.slice(0, 8),
      name: `Cred banner ${suffix}`,
    });
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: officer.hqUserId,
    });
    await attachAshedConnectionToSession(sql, officer.sessionId);
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag},
          updated_at = now()
      WHERE id = ${officer.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(officer));
    const response = await page.goto("/dashboard");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId("alliance-credential-missing")).toBeVisible();
    await expect(
      page.getByTestId("install-alliance-ashed-credentials"),
    ).toBeVisible();
  });

  test("a native alliance does not show the missing-credential banner", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const suffix = nanoid(6);
    const officer = await createAuthenticatedHqSession(
      sql,
      `native-banner-${suffix}@e2e.test`,
    );
    const alliance = await createNativeAlliance(sql, {
      tag: `Nb${suffix}`.slice(0, 8),
      name: `Native banner ${suffix}`,
    });
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: officer.hqUserId,
    });
    await attachAshedConnectionToSession(sql, officer.sessionId);
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag},
          updated_at = now()
      WHERE id = ${officer.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(officer));
    const response = await page.goto("/dashboard");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId("alliance-credential-missing")).toHaveCount(0);
  });
});
