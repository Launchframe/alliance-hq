import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAuthenticatedHqSession,
  createNativeAlliance,
  createAllianceMembership,
  createHqMemberLink,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Welcome recipient redirect", () => {
  test("forwards /welcome?tag=&code= to /join with the code", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `welcome-${nanoid(6)}@e2e.test`,
    );
    const alliance = await createNativeAlliance(sql, {
      tag: `WL${nanoid(3)}`,
      name: "Welcome Redirect Alliance",
    });
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${session.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(session));

    const code = `${alliance.tag.toUpperCase()}-ABCDEF`;
    await page.goto(
      `/welcome?tag=${encodeURIComponent(alliance.tag)}&code=${encodeURIComponent(code)}`,
    );

    await expect(page).toHaveURL(new RegExp(`/join\\?code=${code}`));
    await expect(page.getByRole("heading", { name: /join an alliance/i })).toBeVisible();
  });

  test("forwards /welcome?invite= to /invite/<token>", async ({ page }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `welcome-inv-${nanoid(6)}@e2e.test`,
    );
    await page.context().addCookies(playwrightAuthCookies(session));

    const token = `e2eWelcomeInviteToken${nanoid(16)}`;
    await page.goto(`/welcome?invite=${encodeURIComponent(token)}`);

    await expect(page).toHaveURL(new RegExp(`/invite/${token}`));
  });
});
