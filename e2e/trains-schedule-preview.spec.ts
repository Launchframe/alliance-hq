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

test.describe("Trains schedule preview (no blank state)", () => {
  test("officer with roster sees schedule section and plan-week banner without persisted week", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const tag = `TR${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Trains Preview Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("trains-preview-officer"),
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
      currentName: "Preview Roster Member",
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
      window.localStorage.setItem("trains_walkthrough_seen", "1");
    });

    await page.goto("/trains");

    await expect(page.getByTestId("trains-schedule-section")).toBeVisible();
    await expect(page.getByTestId("trains-no-schedule-section")).toHaveCount(0);
    await expect(page.getByTestId("trains-plan-week-banner")).toBeVisible();
    await expect(page.getByTestId("trains-template-selector")).toBeVisible();
    await expect(page.getByTestId("trains-template-detail-hint")).toBeVisible();
  });

  test("month view shows preview legend for draft days", async ({ page }) => {
    const sql = getE2eSql();
    const tag = `TR${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Trains Month Preview Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("trains-month-preview"),
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
      currentName: "Month Preview Member",
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

    await page.goto("/trains");
    await page.getByRole("tab", { name: /^month$/i }).click();

    await expect(
      page.getByText(/faded days are drafts/i),
    ).toBeVisible();
  });

  test("pre-prod clear week schedule returns dashboard to draft preview", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const tag = `TR${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Trains Clear Week Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("trains-clear-week"),
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
      currentName: "Clear Week Member",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId},
          alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag}
      WHERE id = ${auth.sessionId}
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
    const dashboard = (await dashboardRes.json()) as {
      weekStart: string;
      canClearWeekSchedule: boolean;
      schedulePersisted: boolean;
    };
    expect(dashboard.canClearWeekSchedule).toBe(true);
    expect(dashboard.schedulePersisted).toBe(false);

    const createRes = await request.post("/api/trains/schedule", {
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
      },
      data: {
        weekStart: dashboard.weekStart,
        templateType: "vs_push_week",
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();

    await page.goto("/trains");
    await expect(page.getByTestId("trains-plan-week-banner")).toHaveCount(0);
    await expect(page.getByTestId("trains-clear-week-btn")).toBeVisible();

    await page.getByTestId("trains-clear-week-btn").click();
    await page.getByTestId("trains-clear-week-confirm").click();

    await expect(page.getByTestId("trains-plan-week-banner")).toBeVisible();
    await expect(page.getByTestId("trains-clear-week-btn")).toHaveCount(0);
  });
});
