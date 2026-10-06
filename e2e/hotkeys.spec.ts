import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

test.describe("App hotkeys", () => {
  test("Mod+K opens the command palette", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `HK${nanoid(3)}`,
      name: "Hotkeys Alliance",
    });
    const auth = await createAuthenticatedHqSession(sql, uniqueEmail("hotkeys"));
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/members");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByRole("dialog", { name: "Quick actions" })).toBeVisible();
    await expect(page.getByPlaceholder("Search actions…")).toBeVisible();
  });

  test("palette navigation changes the route", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `HK${nanoid(3)}`,
      name: "Hotkeys Nav Alliance",
    });
    const auth = await createAuthenticatedHqSession(sql, uniqueEmail("hotkeys-nav"));
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/members");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByRole("option", { name: /Go to Alliance Train/i }).click();
    await expect(page).toHaveURL(/\/trains$/);
  });

  test("g3 alias labels VS Performance and the palette keeps a single destination", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `HK${nanoid(3)}`,
      name: "Hotkeys Alias Alliance",
    });
    const auth = await createAuthenticatedHqSession(sql, uniqueEmail("hotkeys-alias"));
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/hotkeys");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await expect(page.getByText("Go to VS Performance").first()).toBeVisible();
    await expect(page.getByText("VS compliance", { exact: true })).toHaveCount(0);

    await page.goto("/members");
    await expect(async () => {
      if (!(await page.getByRole("dialog").isVisible().catch(() => false))) {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      }
      await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("option", { name: /VS compliance/i })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /^Go to VS Performance/ })).toHaveCount(1);
  });

  test("hotkey settings page loads", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `HK${nanoid(3)}`,
      name: "Hotkeys Settings Alliance",
    });
    const auth = await createAuthenticatedHqSession(sql, uniqueEmail("hotkeys-settings"));
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/hotkeys");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Go to Members" }).first()).toBeVisible();
  });

  test("nav Activity link and g . open the activity feed", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `HK${nanoid(3)}`,
      name: "Hotkeys Activity Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("hotkeys-activity"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/members");
    const activityLink = page.getByRole("link", {
      name: "Activity",
      exact: true,
    });
    await expect(activityLink).toBeVisible();
    await activityLink.click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(
      page.getByRole("heading", { name: "Activity" }),
    ).toBeVisible();

    await page.goto("/members");
    await page
      .getByRole("link", { name: "Activity", exact: true })
      .focus();
    await page.keyboard.press("g");
    await page.keyboard.press(".");
    await expect(page).toHaveURL(/\/activity$/);
  });

  test("admin sequence j opens global activity for maintainers only", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `HK${nanoid(3)}`,
      name: "Hotkeys Admin Activity Alliance",
    });
    const maintainer = await createPlatformMaintainerSession(sql);
    await createAllianceMembership(sql, {
      hqUserId: maintainer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "maintainer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: maintainer.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${maintainer.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: maintainer.sessionId,
        nextAuthToken: maintainer.nextAuthToken,
      }),
    );

    await page.goto("/members");
    await page
      .getByRole("link", { name: "Activity", exact: true })
      .focus();
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/admin$/);
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/activity\?scope=global/);
    await expect(
      page.getByRole("link", { name: "Global", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});
