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
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: /Process this video\?/i }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /Process now/i }),
    ).toBeVisible();
    await expect(panel.getByText(/desert-storm/i)).toBeVisible();
  });
});
