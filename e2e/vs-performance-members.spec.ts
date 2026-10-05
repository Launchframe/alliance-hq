import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type Page } from "@playwright/test";

import { addCalendarDays } from "../src/lib/trains/game-time";
import { lastClosedVsWeek } from "../src/lib/vs-compliance/workflow.shared";
import {
  authCookieHeader,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
  type SessionFixture,
} from "./fixtures/db";

type Actor = SessionFixture & { headers: { Cookie: string } };

const DAILY_MIN = 1_000_000;

export async function setupVsMembersFixture() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `VM${nanoid(5)}`,
    name: "VS Members Table",
  });
  const actor = async (roleName: "officer" | "member"): Promise<Actor> => {
    const session = await createAuthenticatedHqSession(
      sql,
      `vsm-${roleName}-${randomBytes(4).toString("hex")}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName,
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
    });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag} WHERE id = ${session.sessionId}`;
    return { ...session, headers: { Cookie: authCookieHeader(session) } };
  };

  const weekEnding = lastClosedVsWeek();
  const weekStart = addCalendarDays(weekEnding, -6);
  const days = Array.from({ length: 6 }, (_, i) => addCalendarDays(weekEnding, i - 6));

  await sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, daily_target, leeway_pct, allowed_missed_days, model_version, preset, demotion_unit, demotion_length, promotion_unit, promotion_length)
    VALUES (${nanoid()}, ${alliance.allianceId}, 1, ${weekEnding}, true, ${DAILY_MIN}, 0, 1, 2, 'rank_aware', 'weeks', 1, 'weeks', 2)`;

  const member = async (name: string) => {
    const row = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: name,
      allianceRank: 3,
    });
    await sql`UPDATE alliance_members SET join_date = '2020-01-01' WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${row.ashedMemberId}`;
    return row.ashedMemberId;
  };
  const score = (memberId: string, date: string, value: number) =>
    sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version)
      VALUES (${nanoid()}, ${alliance.allianceId}, ${memberId}, 'M', ${date}, 'daily', ${value}, 'hq', 1)`;

  // Meeting: all 6 days at the daily minimum.
  const meeting = await member("VSM Meeting");
  for (const day of days) await score(meeting, day, DAILY_MIN + 100);
  // Below: two days under minimum (allowed = 1).
  const below = await member("VSM Below");
  for (const [i, day] of days.entries()) await score(below, day, i < 2 ? 10 : DAILY_MIN + 100);
  // Zero: all six days at 0.
  const zero = await member("VSM Zero");
  for (const day of days) await score(zero, day, 0);
  // Needs evidence: five days met, one day with no score.
  const missing = await member("VSM Missing");
  for (const day of days.slice(0, 5)) await score(missing, day, DAILY_MIN + 100);
  // Partly excused: five days met, one excused via time off.
  const excused = await member("VSM Excused");
  for (const day of days.slice(0, 5)) await score(excused, day, DAILY_MIN + 100);
  const entryId = nanoid();
  const excusedDay = days[5];
  await sql`INSERT INTO member_time_off(id, alliance_id, ashed_member_id, member_name, start_date, end_date, global_absence, availability, entry_kind, activity_scope, source, notice_verified, sync_status)
    VALUES (${entryId}, ${alliance.allianceId}, ${excused}, 'VSM Excused', ${excusedDay}, ${excusedDay}, true, 'full_away', 'planned', 'vs', 'web', true, 'local')`;
  await sql`INSERT INTO member_time_off_revisions(id, entry_id, alliance_id, version, snapshot, recorded_at)
    VALUES (${nanoid()}, ${entryId}, ${alliance.allianceId}, 1,
      ${sql.json({ startDate: excusedDay, endDate: excusedDay, entryKind: "planned", globalAbsence: true, cancelled: false, activityScope: "vs" })},
      '2020-01-01T00:00:00Z')`;

  return { sql, alliance, weekEnding, weekStart, days, actor };
}

async function openPage(page: Page, actor: Actor, path = "") {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto(`/vs-performance${path}`);
}

test("officer member table shows statuses, filters, sorts, and pagination", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await openPage(page, officer, `?week=${f.weekStart}`);

  const section = page.getByTestId("vs-members-section");
  await expect(section.getByRole("heading", { name: "Member performance" })).toBeVisible();
  const table = page.getByTestId("vs-members-table");
  await expect(table).toBeVisible();

  const rowFor = (name: string) => table.getByRole("row").filter({ hasText: name });
  await expect(table.locator("thead th")).toHaveText([
    "Member",
    "Rank",
    "Performance status",
    "Rank outlook",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Total",
    "Days meeting minimum",
  ]);

  await expect(rowFor("VSM Meeting")).toContainText("Meeting expectations");
  await expect(rowFor("VSM Below")).toContainText("Below minimum");
  await expect(rowFor("VSM Zero")).toContainText("No participation");
  await expect(rowFor("VSM Missing")).toContainText("Needs evidence");
  await expect(rowFor("VSM Excused")).toContainText("Partly excused");

  // Day cells expose a full accessible label via sr-only text.
  await expect(
    rowFor("VSM Meeting").locator("td").nth(4).locator(".sr-only"),
  ).toHaveText(/Mon: Met minimum/);
  await expect(
    rowFor("VSM Excused").locator("td").nth(9).locator(".sr-only"),
  ).toHaveText(/Sat: Excused/);

  // Filter by status updates URL and rows.
  await section.getByRole("button", { name: "Performance status" }).click();
  await page.getByRole("option", { name: "Below minimum" }).click();
  await expect(page).toHaveURL(/status=below/);
  await expect(rowFor("VSM Below")).toBeVisible();
  await expect(rowFor("VSM Meeting")).toHaveCount(0);

  // Clear filters restores all five rows.
  await section.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(table.getByRole("row")).toHaveCount(6); // header + 5

  // Sort by Total via header sets aria-sort.
  await table.getByRole("button", { name: "Total" }).click();
  await expect(page).toHaveURL(/sort=total/);
  await expect(table.locator("th", { hasText: "Total" })).toHaveAttribute("aria-sort", "descending");
  await expect(table.getByRole("row").nth(1)).toContainText("VSM");

  // Reload restores filters from the URL.
  await page.reload();
  await expect(table.getByRole("button", { name: "Total" })).toBeVisible();
  await expect(table.locator("th", { hasText: "Total" })).toHaveAttribute("aria-sort", "descending");

  // Page size select is wired to the URL.
  await section.getByRole("button", { name: "Rows per page" }).click();
  await page.getByRole("option", { name: "100", exact: true }).click();
  await expect(page).toHaveURL(/pageSize=100/);
  await expect(page.getByTestId("vs-members-showing")).toContainText("5");
});

test("member role keeps the page but cannot see the member table or the API", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const member = await f.actor("member");
  await openPage(page, member, `?week=${f.weekStart}`);
  await expect(page.getByRole("heading", { name: /Week of/ })).toBeVisible();
  await expect(page.getByTestId("vs-members-section")).toHaveCount(0);
  const res = await request.get(`/api/vs-performance/members?weekStart=${f.weekStart}`, { headers: member.headers });
  expect(res.status()).toBe(403);
});

test("pt-BR localizes the member table", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await page.context().addCookies(playwrightAuthCookies(officer));
  await page.goto(`/pt-BR/vs-performance?week=${f.weekStart}`);
  const table = page.getByTestId("vs-members-table");
  await expect(table).toBeVisible();
  await expect(page.getByTestId("vs-members-section")).toContainText("Desempenho dos membros");
  await expect(table.getByRole("row").filter({ hasText: "VSM Meeting" })).toContainText("Cumprindo as expectativas");
});

test("changing the week resets pagination to page 1 while keeping filters", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await openPage(page, officer, `?week=${f.weekStart}&status=meeting&page=2`);

  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(page).toHaveURL(/status=meeting/);
});

test("member table stays inside a scroll container at 390px and renders in dark theme", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await page.setViewportSize({ width: 390, height: 800 });
  await openPage(page, officer, `?week=${f.weekStart}`);
  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  const fg = await page.getByTestId("vs-members-table").evaluate((el) => getComputedStyle(el).color);
  expect(fg).not.toBe("rgb(0, 0, 0)");
});
