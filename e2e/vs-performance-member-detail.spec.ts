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
import { setupVsMembersFixture } from "./fixtures/vs-members";

type Actor = SessionFixture & { headers: { Cookie: string } };

const DAILY_MIN = 1_000_000;

async function memberIdByName(sql: ReturnType<typeof getE2eSql>, allianceId: string, name: string) {
  const [row] = await sql`SELECT ashed_member_id FROM alliance_members WHERE alliance_id = ${allianceId} AND current_name = ${name}`;
  return row.ashed_member_id as string;
}

async function openDetail(page: Page, actor: Actor, memberId: string, weekStart: string) {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto(`/vs-performance/members/${memberId}?week=${weekStart}`);
}

test("officer follows the member link, sees the detail, and Back restores filters and focus", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const belowId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Below");

  await page.context().addCookies(playwrightAuthCookies(officer));
  await page.goto(`/vs-performance?week=${f.weekStart}&status=below`);
  const link = page.locator(`#vs-member-link-${belowId}`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/vs-performance/members/${belowId}\\?week=${f.weekStart}`));

  await expect(page.getByRole("heading", { name: "VSM Below · VS Performance" })).toBeVisible();
  await expect(page.getByText("Below minimum", { exact: true }).first()).toBeVisible();
  const grid = page.getByTestId("vs-member-day-grid");
  await expect(grid.locator("li").nth(0).locator(".sr-only")).toHaveText(/Mon: Below minimum/);
  await expect(grid.locator("li").nth(2).locator(".sr-only")).toHaveText(/Wed: Met minimum/);
  await expect(page.getByTestId("vs-member-history-list")).toBeVisible();

  await page.getByRole("link", { name: "Back to VS Performance" }).click();
  await expect(page).toHaveURL(/status=below/);
  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  await expect(page.locator(`#vs-member-link-${belowId}`)).toBeFocused();
});

test("v2 detail shows sequence facts and confirms a single demotion", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const zeroId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Zero");

  await openDetail(page, officer, zeroId, f.weekStart);
  await expect(page.getByRole("heading", { name: "VSM Zero · VS Performance" })).toBeVisible();
  await expect(page.getByText("No participation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Demotion review: 1 of 1/)).toBeVisible();

  await page.getByRole("button", { name: "Confirm in-game action" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm in-game action" });
  await expect(dialog.getByText(/0 met · 6 missed/)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm in-game action" }).click();
  await expect(dialog.getByText("Action recorded.", { exact: true })).toBeVisible();

  const ranks = await f.sql`SELECT alliance_rank FROM member_alliance_rank_events WHERE alliance_id = ${f.alliance.allianceId} AND source = 'vs_compliance'`;
  expect(ranks.map((row) => row.alliance_rank)).toEqual([2]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm in-game action" })).toHaveCount(0);
});

test("waiver keeps its reason private to the officer decision history", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const zeroId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Zero");

  await openDetail(page, officer, zeroId, f.weekStart);
  await expect(page.getByRole("heading", { name: "VSM Zero · VS Performance" })).toBeVisible();
  await page.getByRole("button", { name: "Waive this week" }).click();
  const dialog = page.getByRole("dialog", { name: "Waive this week" });
  await dialog.getByLabel("Reason for waiver").fill("Private member waiver");
  await expect(dialog.getByLabel("Reason for waiver")).toHaveValue("Private member waiver");
  await dialog.getByRole("button", { name: "Waive this week" }).click();
  const savedOrAlert = dialog.getByText("Week waived.", { exact: true }).or(dialog.getByRole("alert"));
  try {
    await savedOrAlert.waitFor({ timeout: 20000 });
  } catch {
    const submit = dialog.getByRole("button", { name: "Waive this week" });
    console.log("SUBMIT STATE disabled:", await submit.isDisabled().catch(() => "?"), "count:", await submit.count());
    throw new Error("waive produced neither success nor alert");
  }
  if (await dialog.getByRole("alert").isVisible().catch(() => false)) {
    throw new Error(`waiver failed: ${await dialog.getByRole("alert").textContent()}`);
  }
  await expect(dialog.getByText("Week waived.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const index = await request.get(`/api/vs-performance/members?weekStart=${f.weekStart}`, { headers: officer.headers });
  expect(await index.text()).not.toContain("Private member waiver");
  const detail = await request.get(`/api/vs-performance/members/${zeroId}?weekStart=${f.weekStart}`, { headers: officer.headers });
  const detailText = await detail.text();
  expect(detailText).not.toContain("Private member waiver");
  expect(detailText).not.toContain("evaluationBasis");

  const decisions = page.getByTestId("vs-member-decision-history");
  await decisions.locator("summary").click();
  await expect(decisions).toContainText("Private member waiver");
  await expect(decisions).toContainText("Week waived.");
});

test("member, data-entry, anonymous and foreign officers cannot open member details", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  const belowId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Below");
  const detailPath = `/api/vs-performance/members/${belowId}?weekStart=${f.weekStart}`;
  const revisionPath = `/api/vs-performance/members/${belowId}/revisions?weekStart=${f.weekStart}`;

  expect((await request.get(detailPath)).status()).toBe(401);
  expect((await request.get(revisionPath)).status()).toBe(401);

  for (const role of ["member", "data_entry"] as const) {
    const actor = await f.actor(role);
    expect((await request.get(detailPath, { headers: actor.headers })).status()).toBe(403);
    expect((await request.get(revisionPath, { headers: actor.headers })).status()).toBe(403);
    await page.context().addCookies(playwrightAuthCookies(actor));
    await page.goto(`/vs-performance/members/${belowId}?week=${f.weekStart}`);
    await expect(page.getByTestId("vs-member-day-grid")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /· VS Performance/ })).toHaveCount(0);
    await page.context().clearCookies();
  }

  const foreign = await setupVsMembersFixture();
  const foreignOfficer = await foreign.actor("officer");
  const cross = await request.get(detailPath, { headers: foreignOfficer.headers });
  expect(cross.status()).toBe(404);
  expect(await cross.text()).not.toContain("VSM Below");
  expect((await request.get(revisionPath, { headers: foreignOfficer.headers })).status()).toBe(404);
  expect((await request.get(detailPath, { headers: officer.headers })).status()).toBe(200);
});

test("twelve-week history paginates while the selected week stays visible", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");

  const memberSnapshot = { active: true, joinedAt: "2020-01-01T02:00:00.000Z", leftAt: null, currentRank: 3, rankVersion: "r", isOwner: false };
  for (let index = 1; index <= 14; index++) {
    const weekEnding = addCalendarDays(f.weekEnding, -7 * index);
    await f.sql`INSERT INTO vs_compliance_evaluations(id, alliance_id, member_id, member_name, week_ending, input, evaluation, member_snapshot)
      VALUES (${`hist-${nanoid(8)}`}, ${f.alliance.allianceId}, ${meetingId}, 'VSM Meeting', ${weekEnding},
        ${f.sql.json({ weekEnding, evidence: { state: "ready", score: 48_000_000, source: "weekly", basis: [], dailyCoverage: 0, derivedSaturday: null }, excused: false, pendingExcusal: false, waived: false })},
        ${f.sql.json({ weekEnding, outcome: "passed", threshold: 40_000_000, score: 48_000_000, policyVersion: 1, streak: 0, recommendation: { kind: "none", targetRank: null }, evaluationBasis: "x", confirmationBasis: "x", settled: null, correctionReview: false })},
        ${f.sql.json(memberSnapshot)})`;
  }

  await openDetail(page, officer, meetingId, f.weekStart);
  await expect(page.getByRole("heading", { name: "VSM Meeting · VS Performance" })).toBeVisible();
  const history = page.getByTestId("vs-member-history-list");
  await expect(history.locator("li")).toHaveCount(12);
  await expect(page.getByTestId("vs-member-day-grid")).toBeVisible();
  await page.getByRole("button", { name: "Load earlier weeks" }).click();
  await expect(history.locator("li")).toHaveCount(14);
  await expect(page.getByRole("button", { name: "Load earlier weeks" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "VSM Meeting · VS Performance" })).toBeVisible();
  await expect(page.getByTestId("vs-member-day-grid")).toBeVisible();
});

test("score history loads lazily and the page stays readable at 390px in both themes", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");
  const [head] = await f.sql`SELECT id FROM vs_score_heads WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${meetingId} LIMIT 1`;
  await f.sql`INSERT INTO vs_score_revisions(id, head_id, alliance_id, version, score, origin, recorded_by_hq_user_id)
    VALUES (${nanoid()}, ${head.id}, ${f.alliance.allianceId}, 1, ${DAILY_MIN + 100}, 'hq', ${officer.hqUserId})`;

  await page.setViewportSize({ width: 390, height: 800 });
  await openDetail(page, officer, meetingId, f.weekStart);
  await expect(page.getByRole("heading", { name: "VSM Meeting · VS Performance" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const revisions = page.getByTestId("vs-member-evidence-history");
  await revisions.locator("summary").click();
  await expect(revisions).toContainText(new Intl.NumberFormat("en-US").format(DAILY_MIN + 100));
  await expect(revisions).not.toContainText("Private");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "VSM Meeting · VS Performance" })).toBeVisible();
});

test("v1 legacy week shows the earlier policy line without v2 sequence facts", async ({ page, request }) => {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `VD${nanoid(5)}`, name: "VS Detail v1" });
  const session = await createAuthenticatedHqSession(sql, `vd-${randomBytes(4).toString("hex")}@e2e.test`);
  await createAllianceMembership(sql, { hqUserId: session.hqUserId, allianceId: alliance.allianceId, roleName: "officer", source: "manual" });
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId });
  await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag} WHERE id = ${session.sessionId}`;
  const officer = { ...session, headers: { Cookie: authCookieHeader(session) } };

  const member = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "VD Legacy", allianceRank: 3 });
  await sql`UPDATE alliance_members SET join_date = '2020-01-01' WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${member.ashedMemberId}`;
  const weekEnding = lastClosedVsWeek();
  const weekStart = addCalendarDays(weekEnding, -6);
  await sql`INSERT INTO vs_compliance_policies(id, alliance_id, version, effective_week, enabled, weekly_minimum, preset) VALUES (${nanoid()}, ${alliance.allianceId}, 1, ${weekEnding}, true, 40000000, 'rank_aware')`;
  await sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version) VALUES (${nanoid()}, ${alliance.allianceId}, ${member.ashedMemberId}, 'VD Legacy', ${weekEnding}, 'weekly', 1, 'hq', 1)`;
  await request.get("/api/vs-compliance", { headers: officer.headers });

  await openDetail(page, officer, member.ashedMemberId, weekStart);
  await expect(page.getByRole("heading", { name: "VD Legacy · VS Performance" })).toBeVisible();
  const selectedWeek = page.getByRole("region", { name: "Selected week" });
  await expect(page.getByText("This week uses the earlier weekly-minimum rules.")).toBeVisible();
  await expect(page.getByText("Below minimum", { exact: true }).first()).toBeVisible();
  await expect(selectedWeek.getByText(/required 40,000,000/)).toBeVisible();
  await expect(page.getByText(/Demotion review:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm in-game action" })).toBeVisible();
});
