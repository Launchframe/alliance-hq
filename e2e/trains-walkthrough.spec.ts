import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

test.describe("Trains welcome tour", () => {
  test("auto-opens for train officers and skip tour dismisses it", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const tag = `TR${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Trains Walkthrough Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("trains-walkthrough-officer"),
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
    await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Walkthrough Roster Member",
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

    await page.addInitScript(() => {
      window.localStorage.removeItem("trains_walkthrough_seen");
    });

    await page.goto("/trains");

    const tourDialog = page.getByRole("dialog", { name: /step 1 of/i });
    await expect(tourDialog).toBeVisible({ timeout: 15_000 });
    await expect(tourDialog).toContainText(/train scheduling hub/i);

    await tourDialog.getByRole("button", { name: /skip tour/i }).click();
    await expect(tourDialog).toHaveCount(0);

    const seen = await page.evaluate(() =>
      window.localStorage.getItem("trains_walkthrough_seen"),
    );
    expect(seen).toBe("1");
  });

  test("await-action steps hide Next until the user completes the action", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const tag = `TR${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Trains Walkthrough Sandbox Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("trains-walkthrough-sandbox"),
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
    await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "Sandbox Roster Member",
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

    await page.addInitScript(() => {
      window.localStorage.removeItem("trains_walkthrough_seen");
    });

    await page.goto("/trains");

    const tourDialog = page.getByRole("dialog", { name: /step/i });
    await expect(tourDialog).toBeVisible({ timeout: 15_000 });

    await tourDialog.getByRole("button", { name: /next/i }).click();
    await expect(tourDialog).toContainText(/economy week/i);
    await expect(
      tourDialog.getByRole("button", { name: /^next/i }),
    ).toHaveCount(0);
    await expect(
      tourDialog.getByRole("button", { name: /skip tour/i }),
    ).toBeVisible();
  });
});
