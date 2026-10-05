import { expect, test, type Page } from "@playwright/test";

import { addCalendarDays } from "../src/lib/trains/game-time";
import { getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { setupVsMembersFixture, type VsMembersActor } from "./fixtures/vs-members";

const DAILY_MIN = 1_000_000;

async function memberIdByName(sql: ReturnType<typeof getE2eSql>, allianceId: string, name: string) {
  const [row] = await sql`SELECT ashed_member_id FROM alliance_members WHERE alliance_id = ${allianceId} AND current_name = ${name}`;
  return row.ashed_member_id as string;
}

async function openDetail(page: Page, actor: VsMembersActor, memberId: string, weekStart: string) {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto(`/vs-performance/members/${memberId}?week=${weekStart}`);
}

test("officer edits a daily score, saves, and the revision shows the private reason", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");

  await openDetail(page, officer, meetingId, f.weekStart);
  const editor = page.getByTestId("vs-member-score-editor");
  await expect(editor).toBeVisible();
  const input = editor.getByTestId(`vs-score-input-daily:${f.days[0]}`);
  await input.fill("0");
  await editor.getByTestId("vs-score-reason").fill("Officer verified zero");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText("Scores saved in HQ.", { exact: true })).toBeVisible();

  const [head] = await f.sql`SELECT score, version FROM vs_score_heads WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${meetingId} AND recorded_date = ${f.days[0]} AND period = 'daily'`;
  expect(Number(head.score)).toBe(0);
  expect(head.version).toBe(2);

  const revisions = page.getByTestId("vs-member-evidence-history");
  await expect(async () => {
    if (!(await revisions.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await revisions.locator("summary").click();
    }
    await expect(revisions).toContainText("Officer correction", { timeout: 1500 });
  }).toPass();
  await expect(revisions).toContainText("Officer verified zero");

  const index = await request.get(`/api/vs-performance/members?weekStart=${f.weekStart}`, { headers: officer.headers });
  expect(await index.text()).not.toContain("Officer verified zero");
});

test("clear records an empty score instead of zero and undo restores the field", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");

  await openDetail(page, officer, meetingId, f.weekStart);
  const editor = page.getByTestId("vs-member-score-editor");
  await editor.getByRole("button", { name: `Clear recorded score for Mon` }).click();
  await expect(editor.getByText("Will be cleared when saved.")).toBeVisible();
  await editor.getByRole("button", { name: "Keep recorded score" }).click();
  const input = editor.getByTestId(`vs-score-input-daily:${f.days[0]}`);
  await expect(input).toHaveValue(String(DAILY_MIN + 100));
  await editor.getByRole("button", { name: `Clear recorded score for Mon` }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText("Scores saved in HQ.", { exact: true })).toBeVisible();
  const [head] = await f.sql`SELECT score FROM vs_score_heads WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${meetingId} AND recorded_date = ${f.days[0]} AND period = 'daily'`;
  expect(head.score).toBeNull();
});

test("a lost save response retries the identical body, and 409 requires review", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");
  const scoresPath = `**/api/vs-performance/members/${meetingId}/scores`;
  const detailUrl = (url: URL) => url.pathname === `/api/vs-performance/members/${meetingId}`;

  await openDetail(page, officer, meetingId, f.weekStart);
  const editor = page.getByTestId("vs-member-score-editor");
  const input = editor.getByTestId(`vs-score-input-daily:${f.days[0]}`);

  const bodies: string[] = [];
  await page.route(scoresPath, async (route) => {
    bodies.push(route.request().postData() ?? "");
    if (bodies.length === 1) {
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  const [baseline] = await f.sql`SELECT count(*)::int AS count FROM vs_score_revisions r INNER JOIN vs_score_heads h ON r.head_id = h.id WHERE h.alliance_id = ${f.alliance.allianceId} AND h.member_id = ${meetingId} AND h.recorded_date = ${f.days[0]} AND h.period = 'daily'`;
  await input.fill("42");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText(/Could not confirm whether the scores were saved/)).toBeVisible();
  await editor.getByRole("button", { name: "Retry" }).click();
  await expect(editor.getByText("Scores saved in HQ.", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  const receipts = await f.sql`SELECT id FROM vs_score_manual_edits WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(receipts).toHaveLength(1);
  const [head] = await f.sql`SELECT score, version FROM vs_score_heads WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${meetingId} AND recorded_date = ${f.days[0]} AND period = 'daily'`;
  expect(Number(head.score)).toBe(42);
  const [after] = await f.sql`SELECT count(*)::int AS count FROM vs_score_revisions r INNER JOIN vs_score_heads h ON r.head_id = h.id WHERE h.alliance_id = ${f.alliance.allianceId} AND h.member_id = ${meetingId} AND h.recorded_date = ${f.days[0]} AND h.period = 'daily'`;
  expect(after.count).toBe(baseline.count + 1);
  await page.unroute(scoresPath);

  // 409: another write moves the head; draft is kept, save blocked until evidence is reviewed
  await input.fill("43");
  await f.sql`UPDATE vs_score_heads SET version = version + 1 WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${meetingId} AND recorded_date = ${f.days[0]} AND period = 'daily'`;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText(/These scores changed while you were editing/)).toBeVisible();
  await expect(input).toHaveValue("43");
  const saveButton = editor.getByRole("button", { name: "Save", exact: true });
  await expect(saveButton).toBeDisabled();
  const review = editor.getByRole("button", { name: "Review latest evidence" });
  await expect(review).toBeVisible();

  // a failed refresh keeps the draft and still blocks save
  await page.route(detailUrl, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await review.click();
  await expect(input).toHaveValue("43");
  await expect(editor.getByText(/These scores changed while you were editing/)).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.unroute(detailUrl);

  // a successful review rebases the draft onto the new head version; save applies it
  await review.click();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(editor.getByText("Scores saved in HQ.", { exact: true })).toBeVisible();
  const [final] = await f.sql`SELECT score FROM vs_score_heads WHERE alliance_id = ${f.alliance.allianceId} AND member_id = ${meetingId} AND recorded_date = ${f.days[0]} AND period = 'daily'`;
  expect(Number(final.score)).toBe(43);
});

test("unclosed days are disabled and dirty edits block navigation", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");
  const liveStart = addCalendarDays(f.weekEnding, 2);

  await openDetail(page, officer, meetingId, liveStart);
  await expect(page.getByRole("heading", { name: "VSM Meeting · VS Performance" })).toBeVisible();
  const editor = page.getByTestId("vs-member-score-editor");
  if (await editor.count()) {
    const disabled = editor.locator("input:disabled");
    await expect(disabled.first()).toBeVisible();
    await expect(editor.getByText("This day is not complete yet. Scores cannot be entered.").first()).toBeVisible();
  }

  const closedStart = f.weekStart;
  await openDetail(page, officer, meetingId, closedStart);
  const closedEditor = page.getByTestId("vs-member-score-editor");
  await expect(closedEditor).toBeVisible();
  await closedEditor.getByTestId(`vs-score-input-daily:${f.days[0]}`).fill("9");
  await page.getByRole("link", { name: "Back to VS Performance" }).click();
  await expect(page.getByRole("dialog").getByText("Discard unsaved changes?")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(closedEditor.getByTestId(`vs-score-input-daily:${f.days[0]}`)).toHaveValue("9");
  await page.getByRole("link", { name: "Back to VS Performance" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/vs-performance\?/);
});

test("score editing is denied for members, data-entry, anonymous and foreign officers", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");
  const path = `/api/vs-performance/members/${meetingId}/scores`;
  const body = { weekStart: f.weekStart, scope: "0".repeat(64), requestId: "req-00001", evidenceFingerprint: "0".repeat(64), inputVersion: 0, changes: [{ recordedDate: f.days[0], period: "daily", expectedHeadVersion: null, operation: "set", score: "1" }] };

  expect((await request.patch(path, { data: body })).status()).toBe(401);
  for (const role of ["member", "data_entry"] as const) {
    const actor = await f.actor(role);
    expect((await request.patch(path, { headers: actor.headers, data: body })).status()).toBe(403);
    await page.context().addCookies(playwrightAuthCookies(actor));
    await page.goto(`/vs-performance/members/${meetingId}?week=${f.weekStart}`);
    await expect(page.getByTestId("vs-member-score-editor")).toHaveCount(0);
    await page.context().clearCookies();
  }
  const foreign = await setupVsMembersFixture();
  const foreignOfficer = await foreign.actor("officer");
  const foreignStatus = (await request.patch(path, { headers: foreignOfficer.headers, data: body })).status();
  expect(foreignStatus).toBeGreaterThanOrEqual(400);
  expect(foreignStatus).toBeLessThan(500);
  expect((await request.patch(path, { headers: officer.headers, data: body })).status()).toBe(409);
});

test("editor labels render in pt-BR and at 390px", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");

  await page.setViewportSize({ width: 390, height: 800 });
  await page.context().addCookies(playwrightAuthCookies(officer));
  await page.goto(`/pt-BR/vs-performance/members/${meetingId}?week=${f.weekStart}`);
  const editor = page.getByTestId("vs-member-score-editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByText("Editar pontuações")).toBeVisible();
  await expect(editor.getByText("Motivo da correção (opcional)")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
