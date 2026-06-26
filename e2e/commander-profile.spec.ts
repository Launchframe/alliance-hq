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
  });

  test("owner sees UID on their own commander profile", async ({ page }) => {
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
