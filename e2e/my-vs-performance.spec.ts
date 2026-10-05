import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import { addCalendarDays } from "../src/lib/trains/game-time";
import { currentVsWeekStart } from "../src/lib/vs-performance/member-performance.shared";
import {
  authCookieHeader,
  createAllianceMembership,
  createAshedAlliance,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  getE2eSql,
  playwrightAuthCookies,
  type Sql,
} from "./fixtures/db";
import { setupVsMembersFixture } from "./fixtures/vs-members";

const DAILY_MIN = 1_000_000;

async function createLinkedMember(
  sql: Sql,
  input: { allianceId: string; roleName?: string; memberName?: string; allianceRank?: number },
) {
  const session = await createAuthenticatedHqSession(
    sql,
    `myvs-${randomBytes(4).toString("hex")}@e2e.test`,
  );
  await createAllianceMembership(sql, {
    hqUserId: session.hqUserId,
    allianceId: input.allianceId,
    roleName: input.roleName ?? "member",
    source: "manual",
  });
  const roster = await createAllianceRosterMember(sql, {
    allianceId: input.allianceId,
    currentName: input.memberName ?? `Self ${nanoid(4)}`,
    allianceRank: input.allianceRank ?? 3,
  });
  await createHqMemberLink(sql, {
    allianceId: input.allianceId,
    hqUserId: session.hqUserId,
    ashedMemberId: roster.ashedMemberId,
    memberDisplayName: input.memberName,
  });
  await sql`UPDATE sessions SET alliance_id = ${input.allianceId}, current_alliance_id = ${input.allianceId} WHERE id = ${session.sessionId}`;
  return { ...session, ashedMemberId: roster.ashedMemberId, memberName: input.memberName ?? "" };
}

async function createCanonicalCommander(
  sql: Sql,
  input: { allianceId: string; hqUserId: string; memberName: string; allianceRank?: number },
) {
  const now = new Date();
  const commanderId = nanoid(16);
  const roster = await createAllianceRosterMember(sql, {
    allianceId: input.allianceId,
    currentName: input.memberName,
    allianceRank: input.allianceRank ?? 3,
  });
  await sql`INSERT INTO commanders (id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at)
    VALUES (${commanderId}, ${input.memberName}, ${input.memberName.toLowerCase()}, ${input.allianceId}, ${now}, ${now})`;
  await sql`INSERT INTO commander_alliance_memberships (id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at)
    VALUES (${nanoid(16)}, ${commanderId}, ${input.allianceId}, ${roster.ashedMemberId}, 'active', ${now}, ${now}, ${now})`;
  await sql`INSERT INTO hq_user_commanders (id, hq_user_id, commander_id, is_primary, linked_at, updated_at)
    VALUES (${nanoid(16)}, ${input.hqUserId}, ${commanderId}, false, ${now}, ${now})`;
  return roster;
}

async function seedScore(sql: Sql, allianceId: string, memberId: string, date: string, score: number) {
  await sql`INSERT INTO vs_score_heads(id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version)
    VALUES (${nanoid()}, ${allianceId}, ${memberId}, 'M', ${date}, 'daily', ${score}, 'hq', 1)`;
}

test("linked member sees own current week, policy line, day states, and read-only hint without officer actions", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const self = await createLinkedMember(f.sql, { allianceId: f.alliance.allianceId, memberName: "My VS Self" });
  const weekStart = currentVsWeekStart();
  const weekEnding = addCalendarDays(weekStart, 6);
  const days = Array.from({ length: 6 }, (_, i) => addCalendarDays(weekEnding, i - 6));
  await seedScore(f.sql, f.alliance.allianceId, self.ashedMemberId, days[0], DAILY_MIN + 50);
  await seedScore(f.sql, f.alliance.allianceId, self.ashedMemberId, days[1], 0);
  await seedScore(f.sql, f.alliance.allianceId, self.ashedMemberId, days[2], DAILY_MIN + 50);
  await f.sql`INSERT INTO vs_compliance_evaluations(id, alliance_id, member_id, member_name, week_ending, input, evaluation, member_snapshot)
    VALUES (${`hist-${nanoid(8)}`}, ${f.alliance.allianceId}, ${self.ashedMemberId}, 'My VS Self', ${f.weekEnding},
      ${f.sql.json({})},
      ${f.sql.json({ weekEnding: f.weekEnding, outcome: "passed", modelVersion: 2, counts: { required: 6, met: 6, missed: 0, excused: 0, unknown: 0 }, score: 48_000_000, threshold: DAILY_MIN, policyVersion: 1, streak: 1, recommendation: { kind: "none", targetRank: null }, signal: { kind: "none", targetRank: null, reached: false }, settled: null, correctionReview: false })},
      ${f.sql.json({ active: true, currentRank: 3, joinedAt: null })})`;

  await page.context().addCookies(playwrightAuthCookies(self));
  await page.goto("/en-US/my-vs-performance");

  await expect(page.getByRole("heading", { name: "My VS Performance" })).toBeVisible();
  await expect(page.getByTestId("my-vs-progress")).toBeVisible();
  await expect(page.getByText(/Daily minimum/)).toBeVisible();
  await expect(page.getByText("Your VS scores are read-only here. Ask an alliance officer to correct them.")).toBeVisible();
  const grid = page.getByTestId("my-vs-days");
  await expect(grid.locator(".sr-only")).toHaveCount(6);

  const api = await request.get("/api/my-vs-performance", { headers: { Cookie: authCookieHeader(self) } });
  expect(api.status()).toBe(200);
  const payload = (await api.json()) as {
    week: { days: Array<{ date: string; state: string }>; dailySubtotal: string | null; knownDays: number };
  };
  const stateLabels: Record<string, string> = {
    open: "Not started",
    in_progress: "In progress",
    met: "Met minimum",
    missed: "Below minimum",
    excused: "Excused",
    pending_excusal: "Excusal needs review",
    missing: "No score recorded",
    conflict: "Conflicting scores",
    unverified: "Score not verified",
    recorded: "Recorded",
  };
  for (const [index, day] of payload.week.days.entries()) {
    await expect(grid.locator(".sr-only").nth(index)).toContainText(stateLabels[day.state]!);
  }
  if (payload.week.dailySubtotal !== null) {
    const formatted = new Intl.NumberFormat("en-US").format(BigInt(payload.week.dailySubtotal));
    await expect(page.getByText(new RegExp(`Daily score subtotal: ${formatted.replace(/[,.]/g, "[,.]")}`))).toBeVisible();
    if (payload.week.knownDays < 6) {
      await expect(
        page.getByText(new RegExp(`Recorded total · ${payload.week.knownDays} of 6 days`)),
      ).toBeVisible();
    }
  }
  await expect(page.getByText(/Reported weekly total/)).toHaveCount(0);
  await expect(page.getByText(/Total:/)).toHaveCount(0);

  await expect(page.getByText("Your performance journey")).toBeVisible();
  await expect(page.getByTestId("my-vs-journey")).toContainText("Meeting expectations");
  await expect(page.getByRole("button", { name: "Confirm in-game action" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Waive/ })).toHaveCount(0);
  await expect(page.getByTestId("my-vs-officer-link")).toHaveCount(0);
});

test("officer sees the officer detail link for their own commander", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const self = await createLinkedMember(f.sql, { allianceId: f.alliance.allianceId, roleName: "officer", memberName: "My VS Officer" });
  await page.context().addCookies(playwrightAuthCookies(self));
  await page.goto("/en-US/my-vs-performance");
  await expect(page.getByRole("heading", { name: "My VS Performance" })).toBeVisible();
  const link = page.getByTestId("my-vs-officer-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", new RegExp(`/vs-performance/members/${self.ashedMemberId}`));
});

test("multi-commander selection switches pages; foreign or unknown memberId is denied", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const session = await createAuthenticatedHqSession(f.sql, `myvs-${randomBytes(4).toString("hex")}@e2e.test`);
  await createAllianceMembership(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, roleName: "member", source: "manual" });
  const first = await createCanonicalCommander(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, memberName: "Alpha Self" });
  const second = await createCanonicalCommander(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, memberName: "Beta Self" });
  await createHqMemberLink(f.sql, {
    allianceId: f.alliance.allianceId,
    hqUserId: session.hqUserId,
    ashedMemberId: first.ashedMemberId,
    memberDisplayName: "Alpha Self",
  });
  const other = await createLinkedMember(f.sql, { allianceId: f.alliance.allianceId, memberName: "Other Member" });
  await f.sql`UPDATE sessions SET alliance_id = ${f.alliance.allianceId}, current_alliance_id = ${f.alliance.allianceId} WHERE id = ${session.sessionId}`;

  await page.context().addCookies(playwrightAuthCookies(session));
  await page.goto("/en-US/my-vs-performance");
  const select = page.getByTestId("my-vs-commander-select");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveText(["Alpha Self", "Beta Self"]);

  const denied = await request.get(`/api/my-vs-performance?memberId=${other.ashedMemberId}`, {
    headers: { Cookie: authCookieHeader(session) },
  });
  expect(denied.status()).toBe(404);
  expect(await denied.text()).not.toContain("Other Member");
  expect((await request.get("/api/my-vs-performance?memberId=ghost-member", { headers: { Cookie: authCookieHeader(session) } })).status()).toBe(404);

  await select.selectOption(second.ashedMemberId);
  await expect(page.getByTestId("my-vs-week")).toBeVisible();
  await expect(select).toHaveValue(second.ashedMemberId);
  await expect(page.getByRole("heading", { name: "My VS Performance" })).toBeVisible();
  expect(first.ashedMemberId).not.toBe(second.ashedMemberId);
});

test("unlinked member gets the link CTA and cannot load any memberId", async ({ page, request }) => {
  const sql = getE2eSql();
  const alliance = await createAshedAlliance(sql, { tag: `MU${nanoid(5)}`, name: "My VS Unlinked" });
  const unlinked = await createAuthenticatedHqSession(sql, `myvs-${randomBytes(4).toString("hex")}@e2e.test`);
  await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: unlinked.hqUserId, roleName: "member", source: "manual" });
  await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${unlinked.sessionId}`;

  await page.context().addCookies(playwrightAuthCookies(unlinked));
  await page.goto("/en-US/my-vs-performance");
  await expect(page.getByText("Link a Commander to see your VS performance.")).toBeVisible();
  const cta = page.getByRole("link", { name: "Link a Commander" });
  await expect(cta).toHaveAttribute("href", /\/onboard\?next=%2Fmy-vs-performance/);
  await expect(page.getByTestId("my-vs-journey")).toHaveCount(0);

  const other = await createLinkedMember(sql, { allianceId: alliance.allianceId, memberName: "Owned By Other" });
  const denied = await request.get(`/api/my-vs-performance?memberId=${other.ashedMemberId}`, {
    headers: { Cookie: authCookieHeader(unlinked) },
  });
  expect(denied.status()).toBe(404);
});

test("older weeks paginate and corrected/settled markers render", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const self = await createLinkedMember(f.sql, { allianceId: f.alliance.allianceId, memberName: "Journey Self" });
  const snapshot = { active: true, currentRank: 3, joinedAt: null };
  for (let index = 0; index < 14; index++) {
    const weekEnding = addCalendarDays(f.weekEnding, -7 * index);
    await f.sql`INSERT INTO vs_compliance_evaluations(id, alliance_id, member_id, member_name, week_ending, input, evaluation, member_snapshot)
      VALUES (${`hist-${nanoid(8)}`}, ${f.alliance.allianceId}, ${self.ashedMemberId}, 'Journey Self', ${weekEnding},
        ${f.sql.json({})},
        ${f.sql.json({ weekEnding, outcome: index === 3 ? "excused" : "passed", modelVersion: 2, counts: { required: 6, met: 6, missed: 0, excused: index === 3 ? 6 : 0, unknown: 0 }, score: 42_000_000, threshold: DAILY_MIN, policyVersion: 1, streak: 0, recommendation: { kind: "none", targetRank: null }, signal: { kind: "none", targetRank: null, reached: false }, settled: index === 1 ? { kind: "demote", targetRank: 2, actionId: "action-secret" } : null, correctionReview: false })},
        ${f.sql.json(snapshot)})`;
  }
  await f.sql`INSERT INTO vs_score_manual_edits (id, alliance_id, actor_id, member_id, week_ending, request_id, request_digest)
    VALUES (${nanoid()}, ${f.alliance.allianceId}, ${self.hqUserId}, ${self.ashedMemberId}, ${f.weekEnding}, ${nanoid()}, 'digest')`;

  await page.context().addCookies(playwrightAuthCookies(self));
  await page.goto("/en-US/my-vs-performance");
  const journey = page.getByTestId("my-vs-journey");
  await expect(journey.locator("li")).toHaveCount(12);
  await expect(journey).toContainText("Recorded scores were corrected this week.");
  await expect(journey).toContainText("Rank change recorded in HQ: R2.");
  await expect(journey).not.toContainText("action-secret");

  await page.getByTestId("my-vs-older-weeks").click();
  await expect(journey.locator("li")).toHaveCount(14);
  await expect(page.getByTestId("my-vs-older-weeks")).toHaveCount(0);
});

test("pt-BR renders localized labels and a lost commander returns to the empty state", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const self = await createLinkedMember(f.sql, { allianceId: f.alliance.allianceId, memberName: "Br Self" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.context().addCookies(playwrightAuthCookies(self));
  await page.goto("/pt-BR/my-vs-performance");
  await expect(page.getByRole("heading", { name: "Meu Desempenho VS" })).toBeVisible();
  await expect(page.getByText("Suas pontuações de VS são somente leitura aqui. Peça a um oficial da aliança para corrigi-las.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await f.sql`UPDATE alliance_members SET status = 'former' WHERE alliance_id = ${f.alliance.allianceId} AND ashed_member_id = ${self.ashedMemberId}`;
  const denied = await page.request.get(`/api/my-vs-performance?memberId=${self.ashedMemberId}`, {
    headers: { Cookie: authCookieHeader(self) },
  });
  expect(denied.status()).toBe(404);

  await page.reload();
  await expect(page.getByText("Vincule um Comandante para ver seu desempenho de VS.")).toBeVisible();
  await expect(page.getByTestId("my-vs-week")).toHaveCount(0);
});

test("switching commanders clears the previous week immediately and a denied selection shows unavailable", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const session = await createAuthenticatedHqSession(f.sql, `myvs-${randomBytes(4).toString("hex")}@e2e.test`);
  await createAllianceMembership(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, roleName: "member", source: "manual" });
  const first = await createCanonicalCommander(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, memberName: "Alpha Self" });
  const second = await createCanonicalCommander(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, memberName: "Beta Self" });
  await createHqMemberLink(f.sql, {
    allianceId: f.alliance.allianceId,
    hqUserId: session.hqUserId,
    ashedMemberId: first.ashedMemberId,
    memberDisplayName: "Alpha Self",
  });
  await f.sql`UPDATE sessions SET alliance_id = ${f.alliance.allianceId}, current_alliance_id = ${f.alliance.allianceId} WHERE id = ${session.sessionId}`;

  await page.context().addCookies(playwrightAuthCookies(session));
  await page.goto("/en-US/my-vs-performance");
  await expect(page.getByTestId("my-vs-week")).toBeVisible();
  const select = page.getByTestId("my-vs-commander-select");

  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/my-vs-performance?memberId=${second.ashedMemberId}`, async (route) => {
    await gate;
    await route.continue();
  });
  await select.selectOption(second.ashedMemberId);
  await expect(select).toHaveValue(second.ashedMemberId);
  await expect(page.getByTestId("my-vs-week")).toHaveCount(0);
  await expect(page.getByTestId("my-vs-journey")).toHaveCount(0);
  release!();
  await expect(page.getByTestId("my-vs-week")).toBeVisible();
  await page.unroute(`**/api/my-vs-performance?memberId=${second.ashedMemberId}`);

  const denied = await request.get(`/api/my-vs-performance?memberId=${first.ashedMemberId}`, {
    headers: { Cookie: authCookieHeader(session) },
  });
  expect(denied.status()).toBe(200);
  await f.sql`UPDATE alliance_members SET status = 'former' WHERE alliance_id = ${f.alliance.allianceId} AND ashed_member_id = ${first.ashedMemberId}`;
  await select.selectOption(first.ashedMemberId);
  await expect(page.getByTestId("my-vs-error")).toHaveText("This Commander is not available in your current alliance.");
  await expect(page.getByTestId("my-vs-commander-select")).toHaveCount(0);
  await expect(page.getByTestId("my-vs-week")).toHaveCount(0);
});

test("a transient load failure shows Retry which reloads the selected commander", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const session = await createAuthenticatedHqSession(f.sql, `myvs-${randomBytes(4).toString("hex")}@e2e.test`);
  await createAllianceMembership(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, roleName: "member", source: "manual" });
  const first = await createCanonicalCommander(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, memberName: "Alpha Retry" });
  const second = await createCanonicalCommander(f.sql, { allianceId: f.alliance.allianceId, hqUserId: session.hqUserId, memberName: "Beta Retry" });
  await createHqMemberLink(f.sql, {
    allianceId: f.alliance.allianceId,
    hqUserId: session.hqUserId,
    ashedMemberId: first.ashedMemberId,
    memberDisplayName: "Alpha Retry",
  });
  await f.sql`UPDATE sessions SET alliance_id = ${f.alliance.allianceId}, current_alliance_id = ${f.alliance.allianceId} WHERE id = ${session.sessionId}`;

  await page.context().addCookies(playwrightAuthCookies(session));
  await page.goto("/en-US/my-vs-performance");
  await expect(page.getByTestId("my-vs-week")).toBeVisible();

  let failing = true;
  await page.route(`**/api/my-vs-performance?memberId=${second.ashedMemberId}`, async (route) => {
    if (failing) {
      await route.fulfill({ status: 500, body: "{}" });
    } else {
      await route.continue();
    }
  });
  const select = page.getByTestId("my-vs-commander-select");
  await select.selectOption(second.ashedMemberId);
  await expect(page.getByTestId("my-vs-error")).toContainText("Could not load your VS performance. Try again.");
  await expect(select).toHaveValue(second.ashedMemberId);
  failing = false;
  await page.getByTestId("my-vs-retry").click();
  await expect(page.getByTestId("my-vs-week")).toBeVisible();
});

test("native unlinked members are sent to the existing onboard linking path", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const unlinked = await createAuthenticatedHqSession(f.sql, `myvs-${randomBytes(4).toString("hex")}@e2e.test`);
  await createAllianceMembership(f.sql, { allianceId: f.alliance.allianceId, hqUserId: unlinked.hqUserId, roleName: "member", source: "manual" });
  await f.sql`UPDATE sessions SET alliance_id = ${f.alliance.allianceId}, current_alliance_id = ${f.alliance.allianceId} WHERE id = ${unlinked.sessionId}`;

  await page.context().addCookies(playwrightAuthCookies(unlinked));
  await page.goto("/en-US/my-vs-performance");
  await page.waitForURL(/\/onboard\?next=/);
  await expect(page.getByText(/connect your HQ account/i)).toBeVisible();
});
