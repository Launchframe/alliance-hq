import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceJoinCodeRow,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  linkNativeAllianceToGameServer,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Welcome recipient redirect", () => {
  test("forwards /welcome?tag=&code= to /join and shows redeem error for unknown codes", async ({
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

    await page.context().addCookies(playwrightAuthCookies(session));

    const code = `${alliance.tag.toUpperCase()}-ABCDEF`;
    await page.goto(
      `/welcome?tag=${encodeURIComponent(alliance.tag)}&code=${encodeURIComponent(code)}`,
    );

    await expect(page).toHaveURL(new RegExp(`/join\\?code=${code}`));
    await expect(page.getByRole("heading", { name: /join an alliance/i })).toBeVisible();
    await expect(page.getByText(/join code not found/i)).toBeVisible({
      timeout: 15_000,
    });
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

  test("auto-redeems /welcome claim code into onboard UID claim step", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `WC${nanoid(3)}`,
      name: "Welcome Claim Alliance",
    });
    await linkNativeAllianceToGameServer(sql, alliance.allianceId, 1203);
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "E2eWelcomeClaimTarget",
    });
    const { code } = await createAllianceJoinCodeRow(sql, {
      allianceId: alliance.allianceId,
      roleName: "member",
      maxRedemptions: 1,
      createdByHqUserId: maintainer.hqUserId,
      targetAshedMemberId: ashedMemberId,
      code: `${alliance.tag.toUpperCase()}-CLAIM1`,
    });

    const email = `welcome-claim-${nanoid(6)}@e2e.test`;
    const auth = await createAuthenticatedHqSession(sql, email);
    await page.context().addCookies(playwrightAuthCookies(auth));

    await page.goto(
      `/welcome?tag=${encodeURIComponent(alliance.tag)}&code=${encodeURIComponent(code)}`,
    );

    await expect(page).toHaveURL(/\/onboard/, { timeout: 20_000 });
    // Claim targets skip the confetti welcome phase and open UID proof directly.
    await expect(
      page.getByRole("heading", { name: /confirm your commander/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(
        /Your alliance invited you to claim E2eWelcomeClaimTarget/i,
      ),
    ).toBeVisible();
    await expect(page.getByLabel(/player uid/i)).toBeVisible();
  });
});
