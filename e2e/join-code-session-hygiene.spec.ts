import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceJoinCodeRow,
  createAuthenticatedHqSession,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  loadBrowserSessionAllianceContext,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Join-code session hygiene", () => {
  test("sign-out clears sticky alliance fields after join-code redeem", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `JH${nanoid(3)}`,
      name: "Join Code Hygiene Alliance",
    });
    const { code } = await createAllianceJoinCodeRow(sql, {
      allianceId: alliance.allianceId,
      roleName: "member",
      createdByHqUserId: maintainer.hqUserId,
    });

    const email = `joincode-${nanoid(6)}@e2e.test`;
    const auth = await createAuthenticatedHqSession(sql, email);

    await page.context().addCookies(playwrightAuthCookies(auth));

    await page.goto("/join");
    await page.getByLabel(/join code/i).fill(code);
    await page.getByRole("button", { name: /join alliance/i }).click();

    await expect(page).toHaveURL(/\/onboard/);
    await expect(page.getByText("Join Code Hygiene Alliance")).toBeVisible();

    const afterRedeem = await loadBrowserSessionAllianceContext(
      sql,
      auth.sessionId,
    );
    expect(afterRedeem?.allianceId).toBe(alliance.allianceId);
    expect(afterRedeem?.currentAllianceId).toBe(alliance.allianceId);

    await page.getByRole("button", { name: /wrong account/i }).click();
    await expect(page).toHaveURL(/\/auth/);

    const afterSignOut = await loadBrowserSessionAllianceContext(
      sql,
      auth.sessionId,
    );
    expect(afterSignOut?.hqUserId).toBeNull();
    expect(afterSignOut?.allianceId).toBeNull();
    expect(afterSignOut?.allianceTag).toBeNull();
    expect(afterSignOut?.currentAllianceId).toBeNull();
  });

  test("another account on the same browser session is not forced into the prior join-code alliance onboard", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `JX${nanoid(3)}`,
      name: "Sticky Join Code Alliance",
    });
    const { code } = await createAllianceJoinCodeRow(sql, {
      allianceId: alliance.allianceId,
      roleName: "member",
      createdByHqUserId: maintainer.hqUserId,
    });

    const userA = await createAuthenticatedHqSession(
      sql,
      `joincode-a-${nanoid(6)}@e2e.test`,
    );
    const userB = await createAuthenticatedHqSession(
      sql,
      `joincode-b-${nanoid(6)}@e2e.test`,
    );

    await page.context().addCookies(playwrightAuthCookies(userA));
    await page.goto("/join");
    await page.getByLabel(/join code/i).fill(code);
    await page.getByRole("button", { name: /join alliance/i }).click();
    await expect(page).toHaveURL(/\/onboard/);
    await expect(page.getByText("Sticky Join Code Alliance")).toBeVisible();

    await page.getByRole("button", { name: /wrong account/i }).click();
    await expect(page).toHaveURL(/\/auth/);

    await page.context().clearCookies();
    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: userA.sessionId,
        nextAuthToken: userB.nextAuthToken,
      }),
    );

    await page.goto("/onboard?next=%2Fdashboard");

    await expect(page).not.toHaveURL(/\/onboard/);
    await expect(page.getByText("Sticky Join Code Alliance")).toHaveCount(0);
    await expect(page).toHaveURL(/\/get-started/);
  });

  test("unauthenticated /onboard redirects to auth instead of 500", async ({
    page,
  }) => {
    await page.context().clearCookies();
    const response = await page.goto("/onboard?next=%2Fdashboard");

    expect(response?.status()).not.toBe(500);
    await expect(page).toHaveURL(/\/auth/);
  });
});
