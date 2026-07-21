import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  addCalendarDays,
  getServerCalendarDate,
} from "../src/lib/trains/game-time";
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

test.describe("Price Is Freight raffle tickets", () => {
  test("member sees ticket panel when weighting is enabled on PIR week", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const tag = `TR${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "PIR Tickets Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("pir-tickets-member"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    const link = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "PIR R3 Member",
      ashedMemberId: link.ashedMemberId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId},
          alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag}
      WHERE id = ${auth.sessionId}
    `;
    await sql`
      UPDATE alliances
      SET train_price_is_right_weighting_enabled = 1
      WHERE id = ${alliance.allianceId}
    `;

    const cookies = playwrightAuthCookies({
      sessionId: auth.sessionId,
      nextAuthToken: auth.nextAuthToken,
    });
    await page.context().addCookies(cookies);
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const dashboardRes = await request.get("/api/trains/schedule", {
      headers: { Cookie: cookieHeader },
    });
    expect(dashboardRes.ok(), await dashboardRes.text()).toBeTruthy();
    const dashboard = (await dashboardRes.json()) as { weekStart: string };

    const createRes = await request.post("/api/trains/schedule", {
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
      },
      data: {
        weekStart: dashboard.weekStart,
        templateType: "price_is_right",
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();

    await page.addInitScript(() => {
      window.localStorage.setItem("trains_walkthrough_seen", "1");
    });

    await page.goto("/trains");
    // Simple Mode hides the conductor card until All Set; wait on schedule instead.
    await expect(page.getByTestId("trains-schedule-section")).toBeVisible({
      timeout: 15_000,
    });

    const today = getServerCalendarDate();
    // Saturday uses the heavy-hitter odds panel (still mounted). Desktop week
    // strip hides carousel "Previous day"; select Friday via the day cell so we
    // assert the weighted VS raffle hero + chart. Train week starts Tuesday →
    // Friday is weekStart + 3.
    const friday = addCalendarDays(dashboard.weekStart, 3);
    if (today !== friday) {
      await page
        .locator(`button[aria-label*="${friday.slice(5)}"]`)
        .first()
        .click();
    }

    await expect(page.getByTestId("price-is-right-tickets-panel")).toBeVisible();
    await expect(page.getByTestId("price-is-right-tickets-hero")).toBeVisible();
    await expect(page.getByTestId("price-is-right-tickets-chart")).toBeVisible();
  });
});
