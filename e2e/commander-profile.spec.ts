import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function insertAllianceMember(
  sql: ReturnType<typeof getE2eSql>,
  input: {
    allianceId: string;
    ashedMemberId: string;
    currentName: string;
    gameUid?: string;
  },
) {
  const now = new Date();
  await sql`
    INSERT INTO alliance_members (
      id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
      status, synced_at, created_at, updated_at, game_uid
    ) VALUES (
      ${nanoid()},
      ${input.allianceId},
      ${input.ashedMemberId},
      ${input.allianceId},
      ${input.currentName},
      'active',
      ${now},
      ${now},
      ${now},
      ${input.gameUid ?? null}
    )
  `;
}

test.describe("Commander profile and admin commanders", () => {
  test("officer opens commander profile from members search", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `CP${nanoid(3)}`,
      name: "Commander Profile Alliance",
    });
    const memberId = `member-${nanoid(8)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: memberId,
      currentName: "E2E Commander Alpha",
      gameUid: "123456789",
    });

    const session = await createAuthenticatedHqSession(sql, uniqueEmail("officer"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto("/members");
    await expect(page).toHaveURL(/\/members$/);
    await page.getByPlaceholder(/name|nome|uid|discord/i).fill("Alpha");
    await expect(page.getByRole("link", { name: "E2E Commander Alpha" })).toBeVisible();
    await page.getByRole("link", { name: "E2E Commander Alpha" }).click();
    await expect(page).toHaveURL(new RegExp(`/members/${memberId}$`));
    await expect(page.getByRole("heading", { name: "E2E Commander Alpha" })).toBeVisible();
    await expect(page.getByText("123456789")).not.toBeVisible();
    await expect(page.getByText("12345678901203")).not.toBeVisible();

    const profileRes = await request.get(
      `${e2eBaseUrl()}/api/members/${memberId}`,
      { headers: { Cookie: authCookieHeader(session) } },
    );
    expect(profileRes.status()).toBe(200);
    const profileBody = (await profileRes.json()) as {
      member: { gameUid: string | null };
    };
    expect(profileBody.member.gameUid).toBeNull();
  });

  test("officer sees donate bricks and warning dialog on peer profile", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DG${nanoid(3)}`,
      name: "Donate Gift Alliance",
    });
    const peerId = `peer-${nanoid(8)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: peerId,
      currentName: "E2E Donate Peer",
      gameUid: "555566667777",
    });

    const session = await createAuthenticatedHqSession(sql, uniqueEmail("donor"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    const donorMemberId = `donor-self-${nanoid(6)}`;
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
      ashedMemberId: donorMemberId,
    });
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: donorMemberId,
      currentName: "E2E Donor Self",
      gameUid: "111122223333",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.route(`**/api/members/${peerId}/donation-store`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://lastwar-us-platform.lastwar.com/pay/v1/officeGoldBrickPaymentLoginServlet?uid=x&loginToken=y&website_platform=new_office",
        }),
      });
    });

    await page.goto(`/members/${peerId}`);
    await expect(page.getByRole("heading", { name: "E2E Donate Peer" })).toBeVisible();
    await expect(page.getByText("555566667777")).not.toBeVisible();
    const donate = page.getByRole("button", { name: /donate bricks|doar tijolos/i }).first();
    await expect(donate).toBeVisible();
    await donate.click();
    await expect(
      page.getByText(/open last war store|abrir a loja last war/i),
    ).toBeVisible();
  });

  test("linked HQ owner sees UID on their own commander profile", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `OW${nanoid(3)}`,
      name: "Owner Profile Alliance",
    });
    const memberId = `owner-member-${nanoid(8)}`;
    const gameUid = "12345678901203";
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: memberId,
      currentName: "E2E Owner Commander",
      gameUid,
    });

    const session = await createAuthenticatedHqSession(sql, uniqueEmail("owner-profile"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
      ashedMemberId: memberId,
      gameUid,
      memberDisplayName: "E2E Owner Commander",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto(`/members/${memberId}`);
    await expect(page.getByRole("heading", { name: "E2E Owner Commander" })).toBeVisible();
    await expect(page.getByText(gameUid)).toBeVisible();

    const profileRes = await request.get(
      `${e2eBaseUrl()}/api/members/${memberId}`,
      { headers: { Cookie: authCookieHeader(session) } },
    );
    expect(profileRes.status()).toBe(200);
    const profileBody = (await profileRes.json()) as {
      member: { gameUid: string | null };
    };
    expect(profileBody.member.gameUid).toBe(gameUid);
  });

  test("cross-alliance commander API returns not found", async ({ request }) => {
    const sql = getE2eSql();
    const allianceA = await createNativeAlliance(sql, {
      tag: `CA${nanoid(3)}`,
      name: "Alliance A",
    });
    const allianceB = await createNativeAlliance(sql, {
      tag: `CB${nanoid(3)}`,
      name: "Alliance B",
    });
    const foreignMemberId = `foreign-${nanoid(8)}`;
    await insertAllianceMember(sql, {
      allianceId: allianceB.allianceId,
      ashedMemberId: foreignMemberId,
      currentName: "Foreign Commander",
    });

    const session = await createAuthenticatedHqSession(sql, uniqueEmail("scoped"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: allianceA.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${allianceA.allianceId}, alliance_id = ${allianceA.allianceId}
      WHERE id = ${session.sessionId}
    `;

    const res = await request.get(
      `${e2eBaseUrl()}/api/members/${foreignMemberId}`,
      {
        headers: {
          Cookie: authCookieHeader(session),
        },
      },
    );
    expect(res.status()).toBe(404);
  });

  test("alliance owner break-glass unlinks another member's HQ account", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `BG${nanoid(3)}`,
      name: "Break Glass Alliance",
    });
    const victimMemberId = `victim-${nanoid(8)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: victimMemberId,
      currentName: "E2E Victim Commander",
      gameUid: "12345678901203",
    });

    const victimSession = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("victim"),
    );
    await createAllianceMembership(sql, {
      hqUserId: victimSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: victimSession.hqUserId,
      ashedMemberId: victimMemberId,
      gameUid: "12345678901203",
      memberDisplayName: "E2E Victim Commander",
    });

    const ownerMemberId = `owner-${nanoid(8)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: ownerMemberId,
      currentName: "E2E Owner Commander",
    });
    const ownerSession = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("owner-breakglass"),
    );
    await createAllianceMembership(sql, {
      hqUserId: ownerSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: ownerSession.hqUserId,
      ashedMemberId: ownerMemberId,
      memberDisplayName: "E2E Owner Commander",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${ownerSession.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(ownerSession));

    await page.goto(`/members/${victimMemberId}`);
    await expect(
      page.getByRole("heading", { name: "E2E Victim Commander" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /unlink hq account/i }).click();
    await expect(page.getByText(/wrong claim/i)).toBeVisible();
    await page.getByRole("button", { name: /^unlink$/i }).click();
    await expect(page.getByText(/commander unlinked/i)).toBeVisible({
      timeout: 15_000,
    });

    const [remainingLink] = await sql<{ id: string }[]>`
      SELECT id FROM hq_member_links
      WHERE alliance_id = ${alliance.allianceId}
        AND ashed_member_id = ${victimMemberId}
    `;
    expect(remainingLink).toBeUndefined();

    const unlinkApi = await request.post(
      `${e2eBaseUrl()}/api/settings/team/commander-links/unlink`,
      {
        headers: { Cookie: authCookieHeader(ownerSession) },
        data: { ashedMemberId: victimMemberId, target: "hq" },
      },
    );
    expect(unlinkApi.status()).toBe(404);
  });

  test("officer cannot see break-glass unlink controls on commander profile", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `OF${nanoid(3)}`,
      name: "Officer Unlink Gate Alliance",
    });
    const memberId = `linked-${nanoid(8)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: memberId,
      currentName: "E2E Linked Commander",
    });

    const linkedSession = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("linked-officer-test"),
    );
    await createAllianceMembership(sql, {
      hqUserId: linkedSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: linkedSession.hqUserId,
      ashedMemberId: memberId,
      memberDisplayName: "E2E Linked Commander",
    });

    const officerSession = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("officer-unlink-gate"),
    );
    await createAllianceMembership(sql, {
      hqUserId: officerSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: officerSession.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${officerSession.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(officerSession));

    await page.goto(`/members/${memberId}`);
    await expect(
      page.getByRole("heading", { name: "E2E Linked Commander" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /unlink hq account/i }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /unlink discord/i }),
    ).not.toBeVisible();
  });

  test("platform maintainer searches admin commanders index", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `AD${nanoid(3)}`,
      name: "Admin Commanders Alliance",
    });
    const searchName = `Admin Search Target ${nanoid(6)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: `admin-member-${nanoid(6)}`,
      currentName: searchName,
      gameUid: "987654321",
    });

    const maintainer = await createPlatformMaintainerSession(sql);
    await page.context().addCookies(playwrightAuthCookies(maintainer));

    await page.goto("/admin/commanders");
    await expect(page.getByRole("heading", { name: /commanders|comandantes/i })).toBeVisible();
    await page.getByPlaceholder(/uid|discord|email/i).fill(searchName);
    await expect(page.getByRole("cell", { name: searchName })).toBeVisible({
      timeout: 15_000,
    });
  });
});
