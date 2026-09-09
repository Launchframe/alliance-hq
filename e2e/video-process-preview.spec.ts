import { expect, test } from "@playwright/test";

import { authCookieHeader, attachAshedConnectionToSession, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import {
  createVideoProcessorScenario,
  insertPendingVideoJob,
} from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("Video process preview", () => {
  test("processor can load process-preview for a pending job", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "desert-storm",
    });

    const res = await request.get(
      `/api/tools/video-upload/${jobId}/process-preview`,
      { headers: { Cookie: authCookieHeader(scenario.processor) } },
    );
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as {
      jobId: string;
      status: string;
      canProcess: boolean;
      primaryEngine: string;
    };
    expect(body.jobId).toBe(jobId);
    expect(body.status).toBe("pending_approval");
    expect(body.canProcess).toBe(true);
    expect(body.primaryEngine).toBeTruthy();
  });

  test("enqueue-only officer can read own job preview but cannot process", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });

    const res = await request.get(
      `/api/tools/video-upload/${jobId}/process-preview`,
      { headers: { Cookie: authCookieHeader(scenario.officer) } },
    );
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as { canProcess: boolean };
    expect(body.canProcess).toBe(false);
  });

  test("processor sees process-after-upload panel via processJob deep link", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "desert-storm",
    });
    await attachAshedConnectionToSession(sql, scenario.processor.sessionId);

    await page.context().addCookies(playwrightAuthCookies(scenario.processor));
    await page.goto(`/tools/video-upload?processJob=${jobId}`);

    const panel = page.getByTestId("video-process-after-upload-panel");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: /Process this video\?/i }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /Process now/i }),
    ).toBeVisible();
    await expect(panel.getByText(/desert-storm/i)).toBeVisible();
    // Survey opens only after Process now.
    await expect(
      page.getByRole("heading", { name: /While you wait/i }),
    ).toHaveCount(0);
  });

  test("processor opens survey after Process now, then lands on review", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "desert-storm",
    });
    await attachAshedConnectionToSession(sql, scenario.processor.sessionId);

    await page.context().addCookies(playwrightAuthCookies(scenario.processor));
    await page.goto(`/tools/video-upload?processJob=${jobId}`);

    const panel = page.getByTestId("video-process-after-upload-panel");
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /While you wait/i }),
    ).toHaveCount(0);

    await panel.getByRole("button", { name: /Process now/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /While you wait/i }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(
      new RegExp(`/tools/video-upload/${jobId}/review`),
    );
  });

  test("upload form hides file picker and upload button until a leaderboard is selected", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await page.context().addCookies(playwrightAuthCookies(scenario.processor));
    await page.goto("/tools/video-upload");

    await expect(
      page.getByLabel("What leaderboard is this?"),
    ).toBeVisible();
    await expect(page.getByText("Video file", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Upload video" }),
    ).toHaveCount(0);
  });

  test("pending jobs appear in an awaiting-approval group on the upload page", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.processor.sessionId,
      enqueuedByHqUserId: scenario.processor.hqUserId,
      scoreTarget: "vs-performance",
    });
    await page.context().addCookies(playwrightAuthCookies(scenario.processor));
    await page.goto("/tools/video-upload");

    const group = page.getByTestId("video-awaiting-approval-uploads");
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("heading", { name: /Awaiting approval/i }),
    ).toBeVisible();
    await expect(
      group.getByRole("link", { name: /Open Video queue/i }),
    ).toBeVisible();
    await expect(
      group.getByRole("button", { name: /Process now/i }),
    ).toHaveCount(0);
  });

  test("enqueue-only officer sees awaiting-approval dialog via awaitingJob deep link", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "desert-storm",
    });

    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto(`/tools/video-upload?awaitingJob=${jobId}`);

    const dialog = page.getByTestId("video-awaiting-approval-dialog");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /Awaiting approval/i }),
    ).toBeVisible();
    await expect(dialog.getByText(/Officers were notified in Discord/i)).toBeVisible();
    await expect(
      page.getByTestId("video-process-after-upload-panel"),
    ).toHaveCount(0);
  });

  test("queue job cards include Inspect linking to job detail", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "desert-storm",
    });
    await page.context().addCookies(playwrightAuthCookies(scenario.processor));
    await page.goto("/tools/video-upload/queue");

    const inspect = page.getByRole("link", { name: /^Inspect$/i });
    await expect(inspect).toBeVisible();
    await expect(inspect).toHaveAttribute("href", new RegExp(`/tools/video-jobs/${jobId}`));
  });
});
