import { expect, test } from "@playwright/test";

import { authCookieHeader, getE2eSql } from "./fixtures/db";
import {
  createVideoProcessorScenario,
  insertAllianceVideoJob,
  insertPendingVideoJob,
} from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/**
 * Cross-device video queue handoff.
 *
 *   phone (officer session) uploads job ──▶ video_jobs.session_id = phone
 *   laptop (owner session, same alliance) ──▶ GET /queue sees job
 *                                           ──▶ GET /api/.../[jobId] loads review JSON
 *
 * Must NOT occur:
 *   - complete/submitted jobs appearing in active queue
 *   - unrelated alliance reading the job (404)
 */
test.describe("Video lifecycle queue — cross-device", () => {
  test("same-alliance owner sees officer-uploaded review job and can load review API", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertAllianceVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      status: "review",
    });

    const queue = await request.get("/api/tools/video-upload/queue", {
      headers: { Cookie: authCookieHeader(scenario.owner) },
    });
    expect(queue.status(), await queue.text()).toBe(200);
    const queueBody = (await queue.json()) as {
      jobs: Array<{ id: string; status: string }>;
    };
    expect(queueBody.jobs.some((job) => job.id === jobId)).toBe(true);
    expect(
      queueBody.jobs.find((job) => job.id === jobId)?.status,
    ).toBe("review");

    const review = await request.get(`/api/tools/video-upload/${jobId}`, {
      headers: { Cookie: authCookieHeader(scenario.owner) },
    });
    expect(review.status(), await review.text()).toBe(200);
    const reviewBody = (await review.json()) as { job: { id: string } };
    expect(reviewBody.job.id).toBe(jobId);
  });

  test("active queue includes in-flight statuses after approval", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertAllianceVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      status: "parsing",
    });

    const res = await request.get("/api/tools/video-upload/queue", {
      headers: { Cookie: authCookieHeader(scenario.processor) },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      jobs: Array<{ id: string; status: string }>;
    };
    expect(body.jobs.some((job) => job.id === jobId && job.status === "parsing")).toBe(
      true,
    );
  });

  test("terminal jobs are hidden from active queue", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const pendingId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });
    const completeId = await insertAllianceVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      status: "complete",
    });

    const res = await request.get("/api/tools/video-upload/queue", {
      headers: { Cookie: authCookieHeader(scenario.owner) },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { jobs: Array<{ id: string }> };
    const ids = body.jobs.map((job) => job.id);
    expect(ids).toContain(pendingId);
    expect(ids).not.toContain(completeId);
  });

  test("different alliance cannot load review JSON for the job", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenarioA = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const scenarioB = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertAllianceVideoJob(sql, {
      allianceId: scenarioA.allianceId,
      sessionId: scenarioA.officer.sessionId,
      enqueuedByHqUserId: scenarioA.officer.hqUserId,
      status: "review",
    });

    const review = await request.get(`/api/tools/video-upload/${jobId}`, {
      headers: { Cookie: authCookieHeader(scenarioB.owner) },
    });
    expect(review.status()).toBe(404);
  });
});
