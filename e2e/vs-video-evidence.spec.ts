import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import {
  authCookieHeader,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createNativeVsScenario, seedVsReviewJob } from "./fixtures/vs-evidence";
import { grantProcessorSlot } from "./fixtures/video-processor";
import { vsVideoDraftFormSchema } from "../src/lib/vs-performance/video-evidence.shared";

const tuesday = "2026-09-29";
const weekStart = "2026-09-28";
const sunday = "2026-10-04";
const dayTwoPng = "src/lib/vs-performance/fixtures/vs-day-two-completed-redacted.png";
const dailyPng = "src/lib/vs-performance/fixtures/vs-daily-totals-redacted.png";
const weeklyPng = "src/lib/vs-performance/fixtures/vs-weekly-two-wins.png";

type Sql = ReturnType<typeof getE2eSql>;

async function createScenario(sql: Sql) {
  const f = await createNativeVsScenario(sql);
  await sql`UPDATE alliances SET tag = 'LFgo', game_server_number = 1203 WHERE id = ${f.allianceId}`;
  return f;
}

function evidenceBase(jobId: string) {
  return `/api/tools/video-upload/${jobId}/vs-evidence`;
}

function panel(page: Page) {
  return page.getByTestId("vs-video-evidence-panel");
}

async function gotoReview(page: Page, jobId: string, locale = "en-US") {
  await page.goto(`/${locale}/tools/video-upload/${jobId}/review`);
  await expect(panel(page)).toBeVisible({ timeout: 30_000 });
}

async function attachScreenshot(
  page: Page,
  filePath: string,
  readyText = "Screenshot ready for review.",
) {
  await panel(page).locator('input[type="file"]').setInputFiles(filePath);
  await expect(
    panel(page).getByText(readyText, { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
}

async function reviewDailyDayTwo(page: Page) {
  await attachScreenshot(page, dayTwoPng);
  await page.getByTestId("vs-video-ourside").selectOption("left");
  await panel(page)
    .getByLabel("Left alliance Tag", { exact: true })
    .fill("LFgo");
  await panel(page)
    .getByLabel("Opponent alliance tag", { exact: true })
    .fill("TriV");
  await page.getByTestId("vs-video-confirm-sides").check();
  await page.getByTestId("vs-video-finalday").check();
}

async function evidenceRow(sql: Sql, jobId: string, allianceId: string) {
  const [row] = await sql`
    SELECT recorded_date, period, status, image_version, image_sha256, draft
    FROM video_vs_evidence
    WHERE job_id = ${jobId} AND alliance_id = ${allianceId}`;
  return row;
}

type RouteHold = {
  requests: Request[];
  release: () => Promise<void>;
  stop: () => Promise<void>;
};

async function holdRoute(
  page: Page,
  pattern: string,
  method?: string,
): Promise<RouteHold> {
  const requests: Request[] = [];
  let releaseAll: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  const handler = async (route: Route) => {
    if (method != null && route.request().method() !== method) {
      await route.continue().catch(() => undefined);
      return;
    }
    requests.push(route.request());
    await gate;
    await route.continue().catch(() => undefined);
  };
  await page.route(pattern, handler);
  return {
    requests,
    release: async () => {
      releaseAll();
      await page.waitForTimeout(50);
    },
    stop: async () => {
      releaseAll();
      await page.unroute(pattern, handler);
    },
  };
}

async function dismissRatingPrompt(page: Page) {
  const skip = page
    .locator("div.fixed.inset-0.z-50")
    .getByRole("button", { name: "Skip", exact: true });
  try {
    await skip.waitFor({ state: "visible", timeout: 5_000 });
    await skip.click();
  } catch {
  }
}

test.describe.configure({ timeout: 300_000 });

test("a) VS upload attaches screenshot evidence when the job is created", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await page.goto(
    `/en-US/tools/video-upload?scoreTarget=vs-performance&recordedDate=${tuesday}`,
  );

  await page
    .locator('input[type="file"][accept*="video"]')
    .setInputFiles({
      name: "clip.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(2048, 7),
    });
  const uploadButton = page.getByRole("button", {
    name: "Upload video",
    exact: true,
  });
  await expect(uploadButton).toBeEnabled({ timeout: 30_000 });
  await page
    .getByLabel("Add a VS results screenshot (optional)", { exact: true })
    .setInputFiles(dayTwoPng);

  const postResponse = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/tools/video-upload") &&
      res.request().method() === "POST",
  );
  await uploadButton.click();
  const res = await postResponse;
  expect(res.status()).toBe(200);
  const { jobId } = (await res.json()) as { jobId: string };

  const [job] = await sql`
    SELECT status FROM video_jobs WHERE id = ${jobId}`;
  expect(job.status).toBe("pending_approval");

  await expect
    .poll(async () => (await evidenceRow(sql, jobId, f.allianceId))?.status, {
      timeout: 30_000,
    })
    .toBe("queued");
  const row = await evidenceRow(sql, jobId, f.allianceId);
  expect(row.recorded_date).toBe(tuesday);
  expect(row.period).toBe("daily");
  expect(row.image_version).toBe(1);
  expect(row.image_sha256).toBeTruthy();
  await expect(
    page.getByText(
      "Could not attach the screenshot. Your video upload can continue.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("a2) aborted screenshot upload keeps the video success and the file retryable", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await page.goto(
    `/en-US/tools/video-upload?scoreTarget=vs-performance&recordedDate=${tuesday}`,
  );
  await page.route("**/vs-evidence/upload*", (route) => route.abort());

  await page
    .locator('input[type="file"][accept*="video"]')
    .setInputFiles({
      name: "clip.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(2048, 9),
    });
  const uploadButton = page.getByRole("button", {
    name: "Upload video",
    exact: true,
  });
  await expect(uploadButton).toBeEnabled({ timeout: 30_000 });
  await page
    .getByLabel("Add a VS results screenshot (optional)", { exact: true })
    .setInputFiles(dayTwoPng);

  const postResponse = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/tools/video-upload") &&
      res.request().method() === "POST",
  );
  await uploadButton.click();
  expect((await postResponse).status()).toBe(200);

  await expect(
    page.getByText(
      "Could not attach the screenshot. Your video upload can continue.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("vs-day-two-completed-redacted.png", { exact: true }),
  ).toBeVisible();
});

test("b) daily totals screenshot drives the totals comparison and combined save", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 2_220_000_000,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);
  await reviewDailyDayTwo(page);

  const comparison = page.getByTestId("vs-video-comparison");
  await expect(comparison).toBeVisible();
  await expect(comparison.getByText("Close enough", { exact: true })).toBeVisible();
  await expect(
    comparison.getByText("Total Scores for Day 2", { exact: false }),
  ).toBeVisible();

  const scoreInput = page.getByLabel("Score", { exact: true }).first();
  const saveButton = page.getByRole("button", {
    name: "Save 1 scores",
    exact: true,
  });
  const [scoreBox, comparisonBox, saveBox] = await Promise.all([
    scoreInput.boundingBox(),
    comparison.boundingBox(),
    saveButton.boundingBox(),
  ]);
  expect(comparisonBox!.y).toBeGreaterThan(scoreBox!.y);
  expect(comparisonBox!.y).toBeLessThan(saveBox!.y);

  await scoreInput.fill("2140000000");
  await expect(
    comparison.getByText("Slightly different", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(comparison.getByText("4%", { exact: true })).toBeVisible();
  await scoreInput.fill("2000000000");
  await expect(
    comparison.getByText("You're probably missing some rows", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await scoreInput.fill("2500000000");
  await expect(
    comparison.getByText("You may have extra or duplicate rows", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });
  await scoreInput.fill("2000000000");
  await expect(
    comparison.getByText("You're probably missing some rows", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  await expect
    .poll(async () => (await evidenceRow(sql, job.jobId, f.allianceId))?.draft != null, {
      timeout: 15_000,
    })
    .toBe(true);
  const row = await evidenceRow(sql, job.jobId, f.allianceId);
  const draft = (row.draft as { form?: unknown } | null)?.form;
  expect(vsVideoDraftFormSchema.safeParse(draft).success).toBe(true);

  const submitRequest = page.waitForRequest(
    (req) => req.url().endsWith("/submit") && req.method() === "POST",
  );
  const submitResponse = page.waitForResponse(
    (res) => res.url().endsWith("/submit") && res.request().method() === "POST",
  );
  await page.getByTestId("vs-video-include-results").check();
  await saveButton.click();
  expect((await submitResponse).status()).toBe(200);
  const body = (await submitRequest).postDataJSON() as {
    vsMatchReview?: {
      evidenceVersion: number;
      expectedDayVersions: Record<string, number>;
      data: { source: string };
    };
  };
  const review = body.vsMatchReview!;
  expect(review.data.source).toBe("screenshot");
  expect(Object.keys(review.expectedDayVersions)).toHaveLength(6);
  expect(Object.values(review.expectedDayVersions)).toEqual([0, 0, 0, 0, 0, 0]);

  await expect(
    page.getByText("Saved 1 VS scores in Alliance HQ.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Match results saved in HQ.", { exact: true }),
  ).toBeVisible();

  const [dayResult] = await sql`
    SELECT our_score::text, opponent_score::text, outcome, finality
    FROM vs_match_day_results
    WHERE alliance_id = ${f.allianceId} AND recorded_date = ${tuesday}`;
  expect(dayResult).toMatchObject({
    our_score: "2241713380",
    opponent_score: "2222858900",
    outcome: "won",
    finality: "final",
  });
  const heads = await sql`
    SELECT score::text FROM vs_score_heads
    WHERE alliance_id = ${f.allianceId} AND source_job_id = ${job.jobId}`;
  expect(heads.map((head) => head.score)).toEqual(["2000000000"]);
});

test("c) manual opponent score saves match results without a screenshot or sides", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);

  await expect(
    page.getByTestId("vs-video-comparison"),
  ).toHaveCount(0);
  await panel(page)
    .getByLabel("Opponent score", { exact: true })
    .fill("333");

  await page.getByTestId("vs-video-include-results").check();
  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  await expect(
    page.getByText("Match results saved in HQ.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved 1 VS scores in Alliance HQ.", { exact: true }),
  ).toBeVisible();
  await dismissRatingPrompt(page);
  const [matchup] = await sql`
    SELECT opponent_daily_scores->>1 AS day_two
    FROM vs_matchups
    WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`;
  expect(matchup.day_two).toBe("333");
  expect(
    await sql`
      SELECT our_score::text, opponent_score::text, outcome, finality
      FROM vs_match_day_results
      WHERE alliance_id = ${f.allianceId} AND recorded_date = ${tuesday}`,
  ).toHaveLength(0);
  await expect(
    panel(page).getByText("Player-score sync", { exact: false }),
  ).toHaveCount(0);

  await page.waitForURL(/\/tools\/video-upload\/[^/]+\/event/);
  const dbgRow = await evidenceRow(sql, job.jobId, f.allianceId);
  expect(dbgRow?.draft).toBeNull();
  await expect(page.getByTestId("vs-video-include-results")).not.toBeChecked();
  await expect(page.getByTestId("vs-video-save-match")).toHaveCount(0);
  await expect(
    panel(page).getByText("Screenshot results have not been applied.", {
      exact: false,
    }),
  ).toHaveCount(0);
});

test("d) weekly overview saves reported points and preserves confirmed daily totals", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const dailyJob = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 2_000_000_000,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));

  await gotoReview(page, dailyJob.jobId);
  await reviewDailyDayTwo(page);
  await page.getByTestId("vs-video-include-results").check();
  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  await expect(
    page.getByText("Match results saved in HQ.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await dismissRatingPrompt(page);
  const [dailyResult] = await sql`
    SELECT our_score::text, opponent_score::text, outcome
    FROM vs_match_day_results
    WHERE alliance_id = ${f.allianceId} AND recorded_date = ${tuesday}`;
  expect(dailyResult).toMatchObject({
    our_score: "2241713380",
    opponent_score: "2222858900",
    outcome: "won",
  });

  const weeklyJob = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: sunday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 40_000_000_000,
      },
    ],
  });
  await gotoReview(page, weeklyJob.jobId);
  await attachScreenshot(page, weeklyPng);

  await expect(
    page.getByTestId("vs-video-comparison"),
  ).toHaveCount(0);
  await page.getByTestId("vs-video-ourside").selectOption("left");
  await expect(
    page.getByTestId("vs-video-our-points"),
  ).toHaveValue("3");
  await expect(
    page.getByTestId("vs-video-opponent-points"),
  ).toHaveValue("0");
  await page.getByTestId("vs-video-winner-1").selectOption("left");
  await page.getByTestId("vs-video-winner-2").selectOption("left");
  await page.getByTestId("vs-video-confirm-sides").check();
  await page.getByTestId("vs-video-include-results").check();

  const submitResponse = page.waitForResponse(
    (res) => res.url().endsWith("/submit") && res.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  expect((await submitResponse).status()).toBe(200);
  await expect(
    page.getByText("Match results saved in HQ.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  const [matchup] = await sql`
    SELECT reported_our_points, reported_opponent_points, week_outcome, opponent_daily_scores
    FROM vs_matchups
    WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`;
  expect(matchup.reported_our_points).toBe(3);
  expect(matchup.reported_opponent_points).toBe(0);
  expect(matchup.week_outcome).toBe("pending");
  const days = await sql`
    SELECT recorded_date, our_score::text, opponent_score::text, outcome
    FROM vs_match_day_results
    WHERE alliance_id = ${f.allianceId}
    ORDER BY recorded_date`;
  const dayOne = days.find((row) => row.recorded_date === weekStart);
  const dayTwo = days.find((row) => row.recorded_date === tuesday);
  expect(dayOne?.outcome).toBe("won");
  expect(dayTwo).toMatchObject({
    our_score: "2241713380",
    opponent_score: "2222858900",
    outcome: "won",
  });
});

test("e) held responses preserve in-flight edits and replay a lost save once", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);

  const processHold = await holdRoute(page, `**${evidenceBase(job.jobId)}/process`);
  await panel(page).locator('input[type="file"]').setInputFiles(dailyPng);
  await expect
    .poll(() => processHold.requests.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await panel(page)
    .getByLabel("Opponent alliance tag", { exact: true })
    .fill("HeldTag");
  await processHold.release();
  await expect(
    panel(page).getByText("Screenshot ready for review.", { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await expect(
    panel(page).getByLabel("Opponent alliance tag", { exact: true }),
  ).toHaveValue("HeldTag");
  await expect(page.getByTestId("vs-video-day")).toHaveValue("2");
  await processHold.stop();

  const patchHold = await holdRoute(
    page,
    `**${evidenceBase(job.jobId)}`,
    "PATCH",
  );
  await panel(page)
    .getByLabel("Opponent alliance name", { exact: true })
    .fill("T");
  await expect
    .poll(() => patchHold.requests.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await panel(page)
    .getByLabel("Opponent alliance name", { exact: true })
    .fill("TriVision");
  await page.waitForTimeout(800);
  await patchHold.release();
  await expect
    .poll(() => patchHold.requests.length, { timeout: 10_000 })
    .toBeGreaterThan(1);
  await expect
    .poll(
      async () => {
        const draft = (await evidenceRow(sql, job.jobId, f.allianceId))
          ?.draft as { form?: { opponent?: { name?: string | null } } } | null;
        return draft?.form?.opponent?.name ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe("TriVision");
  await expect(
    panel(page).getByText(
      "This upload or match result changed. Reload and review before saving.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await patchHold.stop();

  await page.reload();
  await expect(panel(page)).toBeVisible({ timeout: 30_000 });
  await expect(
    panel(page).getByLabel("Opponent alliance name", { exact: true }),
  ).toHaveValue("TriVision");
  await expect(page.getByTestId("vs-video-confirm-sides")).not.toBeChecked();

  const uploadHold = await holdRoute(
    page,
    `**${evidenceBase(job.jobId)}`,
    "POST",
  );
  await panel(page).locator('input[type="file"]').setInputFiles(dayTwoPng);
  await page
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect
    .poll(() => uploadHold.requests.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await uploadHold.release();
  await uploadHold.stop();
  await expect(
    panel(page).getByText("Screenshot ready for review.", { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await expect
    .poll(
      async () =>
        panel(page).getByLabel("Opponent alliance name", { exact: true }).inputValue(),
      { timeout: 30_000 },
    )
    .toBe("TriVision");
  await expect(page.getByTestId("vs-video-confirm-sides")).not.toBeChecked();

  const removeHold = await holdRoute(
    page,
    `**${evidenceBase(job.jobId)}`,
    "DELETE",
  );
  const processHold2 = await holdRoute(
    page,
    `**${evidenceBase(job.jobId)}/process`,
  );
  await panel(page)
    .getByRole("button", { name: "Remove screenshot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect
    .poll(() => removeHold.requests.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await removeHold.release();
  await processHold2.release();
  await processHold2.stop();
  await removeHold.stop();
  await expect(
    panel(page).getByRole("button", { name: "Add screenshot", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
});

test("e2) a lost save response retries the identical request and writes one receipt", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);
  await panel(page)
    .getByLabel("Opponent alliance tag", { exact: true })
    .fill("TriV");

  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  await expect(
    page.getByText("Saved 1 VS scores in Alliance HQ.", { exact: true }),
  ).toBeVisible();
  await dismissRatingPrompt(page);
  const saveMatch = page.getByTestId("vs-video-save-match");
  await expect(saveMatch).toBeEnabled();

  let intercepted = false;
  await page.route(`**${evidenceBase(job.jobId)}/save`, async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    await route.fetch();
    await route.abort();
  });
  const requestIds = new Set<string>();
  const bodies = new Set<string>();
  page.on("request", (request) => {
    if (
      request.url().endsWith("/vs-evidence/save") &&
      request.method() === "POST"
    ) {
      const body = request.postData() ?? "";
      bodies.add(body);
      const parsed = JSON.parse(body) as { requestId?: string };
      if (parsed.requestId) requestIds.add(parsed.requestId);
    }
  });

  await saveMatch.click();
  await expect(
    panel(page).getByText("Something went wrong", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  await saveMatch.click();
  await expect(
    page.getByText("Match results saved in HQ.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  expect(requestIds.size).toBe(1);
  expect(bodies.size).toBe(1);
  const scopeRows = await sql`
    SELECT scope_key FROM video_vs_evidence
    WHERE job_id = ${job.jobId} AND alliance_id = ${f.allianceId}`;
  const receipts = await sql`
    SELECT request_id FROM video_vs_evidence_receipts
    WHERE scope_key = ${scopeRows[0].scope_key} AND alliance_id = ${f.allianceId}`;
  expect(receipts).toHaveLength(1);
});

test("f) session and role boundaries hold for evidence reads and writes", async ({
  page,
  request,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  const base = evidenceBase(job.jobId);
  const manualSave = {
    requestId: "e2e-manual-save-request-1",
    submission: {
      evidenceVersion: 1,
      expectedMatchupVersion: 0,
      expectedDayVersions: {},
      data: { source: "manual", opponent: { tag: "TriV" } },
    },
  };
  const draftBody = {
    expectedVersion: 1,
    draft: {
      includeResults: false,
      submission: null,
      form: {
        source: "manual",
        kind: null,
        basisImageVersion: 0,
        editOpponent: false,
        opponent: { server: null, tag: "DRF", name: "Draft Foe" },
        opponentScore: "",
        ourSide: null,
        confirmSides: true,
        finalDay: true,
        day: null,
        left: { server: null, tag: null, name: null },
        right: { server: null, tag: null, name: null },
        leftScore: "",
        rightScore: "",
        leftPoints: "",
        rightPoints: "",
        winners: ["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"],
        expectedMatchupVersion: 0,
        expectedDayVersions: {},
        dirtyFields: ["opponent", "confirmSides", "finalDay"],
      },
    },
  };

  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const anonymousStatuses = [
    (await request.patch(base, { data: draftBody })).status(),
    (await request.post(`${base}/process`)).status(),
    (await request.post(`${base}/save`, { data: manualSave })).status(),
    (await request.post(`${base}/sync`, { data: { target: "scores" } })).status(),
    (await request.get(`${base}/image`)).status(),
  ];
  for (const status of anonymousStatuses) {
    expect([401, 403, 404]).toContain(status);
  }

  const memberJob = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.member,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  const memberBase = evidenceBase(memberJob.jobId);
  const memberHeaders = { Cookie: authCookieHeader(f.member) };
  const ownerHeaders = { Cookie: authCookieHeader(f.owner) };
  const seedRow = await request.patch(memberBase, {
    headers: ownerHeaders,
    data: {
      expectedVersion: 0,
      context: { recordedDate: tuesday, period: "daily" },
      draft: null,
    },
  });
  expect(seedRow.status()).toBe(200);
  expect(
    (await request.post(`${memberBase}/save`, { headers: memberHeaders, data: manualSave })).status(),
  ).toBe(403);
  expect(
    (await request.post(`${memberBase}/process`, { headers: memberHeaders })).status(),
  ).toBe(403);
  expect(
    (await request.post(`${memberBase}/sync`, { headers: memberHeaders, data: { target: "scores" } })).status(),
  ).toBe(403);
  expect(
    (await request.patch(memberBase, { headers: memberHeaders, data: draftBody })).status(),
  ).toBe(403);

  const dataEntryHeaders = { Cookie: authCookieHeader(f.dataEntry) };

  const entryJob = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.dataEntry,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  const entryBase = evidenceBase(entryJob.jobId);
  expect(
    (await request.post(`${entryBase}/save`, { headers: dataEntryHeaders, data: manualSave })).status(),
  ).toBe(403);
  expect(
    (
      await request.post(entryBase, {
        headers: dataEntryHeaders,
        data: {
          expectedVersion: 0,
          fileName: "probe.png",
          fileSize: 128,
          contentType: "image/png",
          requestedKind: "auto",
        },
      })
    ).status(),
  ).toBe(403);

  await page.context().addCookies(playwrightAuthCookies(f.dataEntry));
  await page.goto(`/en-US/tools/video-upload/${entryJob.jobId}/review`);
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/review$/);

  const other = await createScenario(sql);
  const foreignHeaders = { Cookie: authCookieHeader(other.owner) };
  expect([403, 404]).toContain(
    (await request.get(base, { headers: foreignHeaders })).status(),
  );
  expect([403, 404]).toContain(
    (await request.patch(base, { headers: foreignHeaders, data: draftBody })).status(),
  );
  expect([403, 404]).toContain(
    (await request.get(`${base}/image?imageVersion=1`, { headers: foreignHeaders })).status(),
  );

  const ownerContext = {
    context: { recordedDate: tuesday, period: "daily" },
  };
  const seededDraft = await request.patch(base, {
    headers: ownerHeaders,
    data: { ...draftBody, expectedVersion: 0, ...ownerContext },
  });
  expect(seededDraft.status(), await seededDraft.text()).toBe(200);

  await grantProcessorSlot(sql, {
    allianceId: f.allianceId,
    hqUserId: f.otherOfficer.hqUserId,
    grantedByHqUserId: f.owner.hqUserId,
  });
  await page.context().clearCookies();
  await page.context().addCookies(playwrightAuthCookies(f.otherOfficer));
  await gotoReview(page, job.jobId);
  await expect(
    panel(page).getByLabel("Opponent alliance tag", { exact: true }),
  ).toHaveValue("DRF");
  await expect(page.getByTestId("vs-video-include-results")).not.toBeChecked();
});

test("h) sync retries preserve unsaved review edits", async ({
  page,
  request,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  const matchupId = crypto.randomUUID();
  await sql`UPDATE alliances SET ashed_alliance_id = ${`ashed-${job.jobId}`}, operating_mode = 'ashed' WHERE id = ${f.allianceId}`;
  await sql`INSERT INTO vs_matchups (id, alliance_id, week_start) VALUES (${matchupId}, ${f.allianceId}, ${weekStart})`;
  await sql`INSERT INTO vs_matchup_ashed_sync (matchup_id, alliance_id, status) VALUES (${matchupId}, ${f.allianceId}, 'failed')`;
  await sql`INSERT INTO vs_score_sync_scopes (id, alliance_id, recorded_date, period, status) VALUES (${`scope-${job.jobId}`}, ${f.allianceId}, ${tuesday}, 'daily', 'failed')`;
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);

  const base = evidenceBase(job.jobId);
  const evidenceBody = await (
    await request.get(base, {
      headers: { Cookie: authCookieHeader(f.owner) },
    })
  ).text();
  await page.route(`**${base}/sync`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: evidenceBody,
    }),
  );

  const opponentName = panel(page).getByLabel("Opponent alliance name", {
    exact: true,
  });
  const opponentScore = panel(page).getByLabel("Opponent score", {
    exact: true,
  });
  const include = page.getByTestId("vs-video-include-results");
  await opponentName.fill("KeepMeName");
  await opponentScore.fill("555");
  await include.check();

  const scoresRetry = panel(page)
    .locator("span", { hasText: "Player-score sync" })
    .getByRole("button", { name: "Retry", exact: true });
  const matchRetry = panel(page)
    .locator("span", { hasText: "Opponent-info sync" })
    .getByRole("button", { name: "Retry", exact: true });
  await expect(scoresRetry).toBeVisible();
  await expect(matchRetry).toBeVisible();

  await scoresRetry.click();
  await expect(opponentName).toHaveValue("KeepMeName");
  await expect(opponentScore).toHaveValue("555");
  await expect(include).toBeChecked();
  await matchRetry.click();
  await expect(opponentName).toHaveValue("KeepMeName");
  await expect(opponentScore).toHaveValue("555");
  await expect(include).toBeChecked();
});

test("i) a video-only save flushes the pending manual draft", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);

  await panel(page)
    .getByLabel("Opponent alliance name", { exact: true })
    .fill("PendingDraft");
  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  await expect(
    page.getByText("Saved 1 VS scores in Alliance HQ.", { exact: true }),
  ).toBeVisible();
  await dismissRatingPrompt(page);
  await expect(
    page.getByText("Match results saved in HQ.", { exact: true }),
  ).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const draft = (await evidenceRow(sql, job.jobId, f.allianceId))
          ?.draft as { form?: { opponent?: { name?: string | null } } } | null;
        return draft?.form?.opponent?.name ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe("PendingDraft");
  expect(
    await sql`
      SELECT our_score::text FROM vs_match_day_results
      WHERE alliance_id = ${f.allianceId} AND recorded_date = ${tuesday}`,
  ).toHaveLength(0);
  expect(
    await sql`
      SELECT id FROM vs_matchups
      WHERE alliance_id = ${f.allianceId} AND week_start = ${weekStart}`,
  ).toHaveLength(0);

  await page.reload();
  await expect(panel(page)).toBeVisible({ timeout: 30_000 });
  await expect(
    panel(page).getByLabel("Opponent alliance name", { exact: true }),
  ).toHaveValue("PendingDraft");
});

test("j) video-only save is not blocked by in-flight screenshot OCR", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);

  const base = evidenceBase(job.jobId);
  const processHold = await holdRoute(page, `**${base}/process`);
  await panel(page).locator('input[type="file"]').setInputFiles(dailyPng);
  await expect
    .poll(() => processHold.requests.length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  await panel(page)
    .getByLabel("Opponent alliance tag", { exact: true })
    .fill("HeldOCR");
  const submitResponse = page.waitForResponse(
    (res) => res.url().endsWith("/submit") && res.request().method() === "POST",
    { timeout: 30_000 },
  );
  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  expect((await submitResponse).status()).toBe(200);
  await expect(
    page.getByText("Saved 1 VS scores in Alliance HQ.", { exact: true }),
  ).toBeVisible();
  await dismissRatingPrompt(page);
  await processHold.release();
  await processHold.stop();
  await expect
    .poll(
      async () => {
        const draft = (await evidenceRow(sql, job.jobId, f.allianceId))
          ?.draft as { form?: { opponent?: { tag?: string | null } } } | null;
        return draft?.form?.opponent?.tag ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe("HeldOCR");
});

test("k) a context-scope change resets the local review state", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);

  const base = evidenceBase(job.jobId);
  const processHold = await holdRoute(page, `**${base}/process`);
  await panel(page).locator('input[type="file"]').setInputFiles(dailyPng);
  await expect
    .poll(() => processHold.requests.length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const opponentTag = panel(page).getByLabel("Opponent alliance tag", {
    exact: true,
  });
  await opponentTag.fill("EditedTag");

  let realScope = "";
  let gateRelease: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    gateRelease = resolve;
  });
  let patchRelease: () => void = () => {};
  const patchGate = new Promise<void>((resolve) => {
    patchRelease = resolve;
  });
  let count = 0;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "GET") {
      if (route.request().method() === "PATCH") {
        await patchGate;
      }
      await route.continue().catch(() => undefined);
      return;
    }
    const res = await route.fetch();
    const json = (await res.json()) as {
      contextScope: string;
      evidence: { version: number; status: string; draft: unknown };
    };
    realScope ||= json.contextScope;
    count += 1;
    if (count === 1) {
      await route.fulfill({
        response: res,
        json: {
          ...json,
          contextScope: "other-actor-scope",
          evidence: { ...json.evidence, draft: null },
        },
      });
      return;
    }
    await gate;
    await route.fulfill({
      response: res,
      json: {
        ...json,
        evidence: {
          ...json.evidence,
          version: json.evidence.version + 100,
          status: "ready",
          draft: null,
        },
      },
    });
  });

  await expect
    .poll(() => count, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(opponentTag).not.toHaveValue("EditedTag", { timeout: 15_000 });
  await opponentTag.fill("AgainEdited");
  gateRelease();
  await expect(opponentTag).not.toHaveValue("AgainEdited", {
    timeout: 15_000,
  });
  await expect(
    panel(page).getByText(
      "This upload or match result changed. Reload and review before saving.",
      { exact: true },
    ),
  ).toHaveCount(0);
  patchRelease();
  await processHold.release();
  await processHold.stop();
});

test("l) cancel resets only the opponent edit and keeps other edits", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 500,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await gotoReview(page, job.jobId);
  await attachScreenshot(page, dailyPng);

  await page.getByTestId("vs-video-ourside").selectOption("left");
  const ourTotal = panel(page).getByLabel(/Our alliance.s final score/);
  await ourTotal.fill("1234567890");
  const opponentName = panel(page).getByLabel("Opponent alliance name", {
    exact: true,
  });
  await opponentName.fill("FoeToCancel");

  await page
    .getByRole("button", { name: "Save 1 scores", exact: true })
    .click();
  await expect(
    page.getByText("Saved 1 VS scores in Alliance HQ.", { exact: true }),
  ).toBeVisible();
  await dismissRatingPrompt(page);

  await panel(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(opponentName).toHaveValue("");
  await expect(ourTotal).toHaveValue("1234567890");

  await expect
    .poll(
      async () => {
        const draft = (await evidenceRow(sql, job.jobId, f.allianceId))
          ?.draft as {
            form?: {
              opponent?: { name?: string | null };
              leftScore?: string;
            };
          } | null;
        return draft?.form ?? null;
      },
      { timeout: 15_000 },
    )
    .toMatchObject({
      opponent: { name: null },
      leftScore: "1234567890",
    });

  await page.reload();
  await expect(panel(page)).toBeVisible({ timeout: 30_000 });
  await expect(
    panel(page).getByLabel("Opponent alliance name", { exact: true }),
  ).toHaveValue("");
  await expect(
    panel(page).getByLabel(/Our alliance.s final score/),
  ).toHaveValue("1234567890");
});

test("g) localized review renders comparison in Portuguese with private versioned image access", async ({
  page,
  request,
}) => {
  const sql = getE2eSql();
  const f = await createScenario(sql);
  const job = await seedVsReviewJob(sql, {
    allianceId: f.allianceId,
    actor: f.owner,
    recordedDate: tuesday,
    rows: [
      {
        memberId: f.member.memberId,
        memberName: f.member.memberName,
        score: 2_200_000_000,
      },
    ],
  });
  await page.context().addCookies(playwrightAuthCookies(f.owner));
  await page.setViewportSize({ width: 640, height: 900 });
  await gotoReview(page, job.jobId, "pt-BR");
  await attachScreenshot(
    page,
    dayTwoPng,
    "Captura de tela pronta para revisão.",
  );

  const comparison = page.getByTestId("vs-video-comparison");
  await page.getByTestId("vs-video-ourside").selectOption("left");
  await expect(comparison).toBeVisible();
  await expect(
    comparison.getByText("Pontuações Totais de LFgo no Dia 2", { exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByText("Pontuação total da captura de tela", { exact: true }),
  ).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(comparison).toBeVisible();
  await page.screenshot({ path: "/tmp/vs-video-evidence-pt-dark-mobile.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(comparison).toBeVisible();

  await expect(
    panel(page).getByText("Player-score sync", { exact: false }),
  ).toHaveCount(0);

  const headers = { Cookie: authCookieHeader(f.owner) };
  const staleImage = await request.get(
    `${evidenceBase(job.jobId)}/image?imageVersion=999`,
    { headers },
  );
  expect(staleImage.status()).toBe(409);
  const image = await request.get(
    `${evidenceBase(job.jobId)}/image?imageVersion=1`,
    { headers },
  );
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["cache-control"]).toContain("no-store");
  expect(image.headers()["x-content-type-options"]).toBe("nosniff");
  const bytes = await image.body();
  expect(bytes.length).toBeGreaterThan(1_000);
});
