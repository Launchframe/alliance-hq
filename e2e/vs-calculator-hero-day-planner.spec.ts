import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  dateForVsMatchDayInWeek,
  mondayOfVsWeekContaining,
} from "../src/lib/vs-calculator/vs-calendar.shared";
import { getServerCalendarDate } from "../src/lib/trains/game-time";
import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function insertCommanderMembership(
  sql: ReturnType<typeof getE2eSql>,
  input: { allianceId: string; ashedMemberId: string; primaryName: string },
): Promise<{ commanderId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.primaryName},
      ${input.primaryName.toLowerCase()},
      ${input.allianceId},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${commanderId},
      ${input.allianceId},
      ${input.ashedMemberId},
      'active',
      ${now},
      ${now},
      ${now}
    )
  `;

  return { commanderId };
}

function heroDayDateForToday(): string {
  const today = getServerCalendarDate();
  return dateForVsMatchDayInWeek(mondayOfVsWeekContaining(today), 4);
}

test.describe("VS Calculator Hero Day planner", () => {
  test("Plan tab saves push squad on Hero Day pin", async ({ page, request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `VS${nanoid(4)}`,
      name: "VS Planner Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("vs-planner-member"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const link = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await insertCommanderMembership(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: link.ashedMemberId,
      primaryName: "E2E VS Planner",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId},
          alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag}
      WHERE id = ${auth.sessionId}
    `;

    const cookies = playwrightAuthCookies(auth);
    await page.context().addCookies(cookies);

    const heroDayDate = heroDayDateForToday();
    await page.goto(
      `/tools/vs-calculator?date=${encodeURIComponent(heroDayDate)}`,
    );
    await expect(page.getByRole("heading", { name: "VS Calculator" })).toBeVisible();

    const planTab = page.getByTestId("vs-calculator-tab-plan");
    await expect(planTab).toBeVisible();
    await planTab.click();

    const panel = page.getByTestId("vs-calculator-plan-panel");
    await expect(panel).toBeVisible();

    await page.getByTestId("vs-calculator-plan-current-score").fill("6785000");
    await page.getByTestId("vs-calculator-plan-target-score").fill("7200000");
    await page.getByTestId("vs-calculator-plan-hero-label-0").fill("Golden UR");

    const saveResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/tools/vs-calculator/push-profile") &&
        res.request().method() === "PUT" &&
        res.status() === 200,
    );
    await page.getByTestId("vs-calculator-plan-save-profile").click();
    await saveResponse;

    await expect(page.getByTestId("vs-calculator-plan-actions")).toBeVisible();
    await expect(page.getByTestId("vs-calculator-plan-actions")).not.toBeEmpty();

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const profileRes = await request.get(
      `/api/tools/vs-calculator/push-profile?date=${encodeURIComponent(heroDayDate)}`,
      { headers: { Cookie: cookieHeader } },
    );
    expect(profileRes.ok(), await profileRes.text()).toBeTruthy();
    const profileBody = (await profileRes.json()) as {
      payload?: { heroes?: Array<{ label?: string }> };
    };
    expect(profileBody.payload?.heroes?.[0]?.label).toBe("Golden UR");
  });

  test("Plan tab is hidden when pinned date is not Hero Day", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `VS${nanoid(4)}`,
      name: "VS Planner Non-Hero Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("vs-planner-non-hero"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const link = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await insertCommanderMembership(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: link.ashedMemberId,
      primaryName: "E2E VS Non-Hero",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId},
          alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(auth));

    const today = getServerCalendarDate();
    const weekMonday = mondayOfVsWeekContaining(today);
    const nonHeroDate = dateForVsMatchDayInWeek(weekMonday, 1);

    await page.goto(
      `/tools/vs-calculator?date=${encodeURIComponent(nonHeroDate)}`,
    );
    await expect(page.getByRole("heading", { name: "VS Calculator" })).toBeVisible();
    await expect(page.getByTestId("vs-calculator-tab-plan")).toHaveCount(0);
  });
});
