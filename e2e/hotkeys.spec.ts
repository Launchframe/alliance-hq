import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createNativeAlliance,
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
    await expect(page.getByText("Go to Members")).toBeVisible();
  });
});
