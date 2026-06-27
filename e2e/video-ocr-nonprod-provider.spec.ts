import { expect, test } from "@playwright/test";

import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "../src/lib/members/ashed-member-record";
import { authCookieHeader, getE2eSql } from "./fixtures/db";
import {
  createVideoProcessorScenario,
  insertPendingVideoJob,
  loadVideoJobPassKey,
  loadVideoJobStatus,
} from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function activeNonprodOcrProvider(): "mock" | "local" | null {
  const raw = process.env.VIDEO_OCR_PROVIDER?.trim().toLowerCase();
  if (raw === "mock" || raw === "local") return raw;
  return null;
}

/**
 * Approve-path coverage when VIDEO_OCR_PROVIDER is mock or local (non-Ashed OCR).
 *
 * Run via:
 *   npm run test:e2e:video-ocr-mock
 *   npm run test:e2e:video-ocr-local
 *
 * Default `npm run test:e2e` keeps VIDEO_OCR_PROVIDER unset (Ashed) so the 409
 * ashed_not_connected test in video-processor-rbac.spec.ts stays valid.
 */
test.describe("Video OCR nonprod provider approve path", () => {
  test.beforeEach(() => {
    test.skip(
      activeNonprodOcrProvider() === null,
      "Set VIDEO_OCR_PROVIDER=mock or local (see npm run test:e2e:video-ocr-mock)",
    );
  });

  test("processor can approve a score-target job without Ashed", async ({
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

    const res = await request.post(
      `/api/tools/video-upload/${jobId}/approve`,
      { headers: { Cookie: authCookieHeader(scenario.processor) } },
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
    expect(await loadVideoJobStatus(sql, jobId)).toBe("queued");
  });

  test("processor can approve a roster-target job without Ashed and stamps passKey", async ({
    request,
  }) => {
    const provider = activeNonprodOcrProvider();
    test.skip(
      provider !== "mock",
      "Roster mock engine stamps passKey; local uses native Tesseract on roster targets",
    );

    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: MEMBER_ROSTER_VIDEO_SCORE_TARGET,
    });

    const res = await request.post(
      `/api/tools/video-upload/${jobId}/approve`,
      { headers: { Cookie: authCookieHeader(scenario.processor) } },
    );
    expect(res.status(), await res.text()).toBe(200);
    expect(await loadVideoJobStatus(sql, jobId)).toBe("queued");
    expect(await loadVideoJobPassKey(sql, jobId)).toBeTruthy();
  });
});
