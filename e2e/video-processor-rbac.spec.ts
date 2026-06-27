import { expect, test } from "@playwright/test";

import {
  attachAshedConnectionToSession,
  authCookieHeader,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import {
  createMemberWithRole,
  createVideoProcessorScenario,
  insertPendingVideoJob,
  loadVideoJobStatus,
  seedLinkedRosterOfficer,
} from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/**
 * Enqueue / process RBAC boundary.
 *
 *   officer (enqueue only) ── GET /api/tools/video-upload ─────────────▶ 200 (may upload)
 *        │
 *        ├── GET  /api/tools/video-upload/queue ───────────────────────▶ 403 (no read)
 *        └── POST /api/tools/video-upload/{job}/approve ───────────────▶ 403 (no process)
 *
 *   owner / processor (officer + slot) ── GET .../queue ──────────────▶ 200 { canProcess:true }
 *        │
 *        ├── no Ashed → POST .../approve ──────────────────────────────▶ 409 ashed_not_connected (job stays pending)
 *        ├── with Ashed → POST .../approve ───────────────────────────▶ 200 { status:"queued" }
 *        └── POST .../reject ─────────────────────────────────────────▶ 200 { status:"discarded" }
 *
 * Positive assertions:
 *  - Officers can enqueue; designated processors and owners can read the queue and act.
 *  - Approving without Ashed surfaces a recoverable 409 with a connect URL; the job remains pending.
 *  - Approving with Ashed transitions the job out of pending_approval.
 *
 * Must NOT occur:
 *  - An officer without a slot reading the queue, approving, or rejecting (no privilege escalation).
 *  - Approving a job from another alliance (tenant isolation → 404).
 *  - Approving without Ashed returning a 500 or marking the job failed.
 */
test.describe("Video enqueue/process RBAC", () => {
  test("officer can enqueue but cannot read the queue, approve, or reject", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });
    const cookie = authCookieHeader(scenario.officer);

    const enqueue = await request.get("/api/tools/video-upload", {
      headers: { Cookie: cookie },
    });
    expect(enqueue.status(), await enqueue.text()).toBe(200);

    const queue = await request.get("/api/tools/video-upload/queue", {
      headers: { Cookie: cookie },
    });
    expect(queue.status()).toBe(403);

    const approve = await request.post(
      `/api/tools/video-upload/${jobId}/approve`,
      { headers: { Cookie: cookie } },
    );
    expect(approve.status()).toBe(403);

    const reject = await request.post(
      `/api/tools/video-upload/${jobId}/reject`,
      { headers: { Cookie: cookie }, data: { reason: "nope" } },
    );
    expect(reject.status()).toBe(403);

    // Job untouched by the forbidden actions.
    expect(await loadVideoJobStatus(sql, jobId)).toBe("pending_approval");
  });

  test("owner and designated processor can read the queue with canProcess", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });

    for (const actor of [scenario.owner, scenario.processor]) {
      const res = await request.get("/api/tools/video-upload/queue", {
        headers: { Cookie: authCookieHeader(actor) },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as {
        jobs: unknown[];
        canProcess: boolean;
        ashedConnected: boolean;
        connectUrl: string;
      };
      expect(body.canProcess).toBe(true);
      expect(body.ashedConnected).toBe(false);
      expect(body.connectUrl).toBe("/connect");
      expect(body.jobs.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("approve without Ashed returns recoverable 409 and leaves job pending", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });

    const res = await request.post(
      `/api/tools/video-upload/${jobId}/approve`,
      { headers: { Cookie: authCookieHeader(scenario.processor) } },
    );
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { code?: string; connectUrl?: string };
    expect(body.code).toBe("ashed_not_connected");
    expect(body.connectUrl).toBe("/connect");

    expect(await loadVideoJobStatus(sql, jobId)).toBe("pending_approval");
  });

  test("approve with Ashed transitions the job out of pending_approval", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });
    await attachAshedConnectionToSession(sql, scenario.owner.sessionId);

    const res = await request.post(
      `/api/tools/video-upload/${jobId}/approve`,
      { headers: { Cookie: authCookieHeader(scenario.owner) } },
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
  });

  test("reject without Ashed discards the pending job", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });

    const res = await request.post(
      `/api/tools/video-upload/${jobId}/reject`,
      {
        headers: { Cookie: authCookieHeader(scenario.processor) },
        data: { reason: "blurry footage" },
      },
    );
    expect(res.status(), await res.text()).toBe(200);
    expect(await loadVideoJobStatus(sql, jobId)).toBe("discarded");
  });

  test("processor cannot approve a job from another alliance", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());

    // A separate alliance with its own officer-owned pending job.
    const maintainer = await createPlatformMaintainerSession(sql);
    const otherAlliance = await createNativeAlliance(sql, {
      tag: `OT${Math.random().toString(36).slice(2, 6)}`,
      name: "Other Alliance",
    });
    const otherOfficer = await createMemberWithRole(sql, e2eBaseUrl(), {
      allianceId: otherAlliance.allianceId,
      roleName: "officer",
      invitedByHqUserId: maintainer.hqUserId,
    });
    const foreignJobId = await insertPendingVideoJob(sql, {
      allianceId: otherAlliance.allianceId,
      sessionId: otherOfficer.sessionId,
      enqueuedByHqUserId: otherOfficer.hqUserId,
    });

    const res = await request.post(
      `/api/tools/video-upload/${foreignJobId}/approve`,
      { headers: { Cookie: authCookieHeader(scenario.processor) } },
    );
    expect(res.status()).toBe(404);
    expect(await loadVideoJobStatus(sql, foreignJobId)).toBe("pending_approval");
  });
});

test.describe("Video processor settings candidates", () => {
  test("native alliance lists linked R4/R5 members as eligible", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await seedLinkedRosterOfficer(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
      allianceRank: 5,
      allianceRankTitle: "Leader",
    });

    const res = await request.get("/api/settings/video-processors", {
      headers: { Cookie: authCookieHeader(scenario.owner) },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      eligibilityMode: string;
      candidates: Array<{ hqUserId: string; subtitle: string | null }>;
    };
    expect(body.eligibilityMode).toBe("native_r4_r5");
    expect(
      body.candidates.some((c) => c.hqUserId === scenario.officer.hqUserId),
    ).toBe(true);
    expect(
      body.candidates.find((c) => c.hqUserId === scenario.officer.hqUserId)
        ?.subtitle,
    ).toContain("R5");
    expect(
      body.candidates.some((c) => c.hqUserId === scenario.processor.hqUserId),
    ).toBe(false);
  });

  test("members without alliance admin can read processors but not manage", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());

    const readRes = await request.get("/api/settings/video-processors", {
      headers: { Cookie: authCookieHeader(scenario.officer) },
    });
    expect(readRes.status(), await readRes.text()).toBe(200);
    const body = (await readRes.json()) as {
      canManage: boolean;
      candidates: unknown[];
      processors: Array<{ hqUserId: string }>;
    };
    expect(body.canManage).toBe(false);
    expect(body.candidates).toEqual([]);
    expect(
      body.processors.some((p) => p.hqUserId === scenario.processor.hqUserId),
    ).toBe(true);

    const writeRes = await request.post("/api/settings/video-processors", {
      headers: { Cookie: authCookieHeader(scenario.officer) },
      data: { hqUserId: scenario.officer.hqUserId },
    });
    expect(writeRes.status()).toBe(403);
  });
});

test.describe("Video processors page route", () => {
  test("member with alliance access loads /tools/video-processors read-only", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));

    const response = await page.goto("/tools/video-processors");
    expect(response, "No response for /tools/video-processors").toBeTruthy();
    expect(response!.status()).toBeLessThan(500);
    await expect(
      page.getByRole("heading", { name: /^video processors$/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/only alliance owners and maintainers can add or remove processors/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^add$/i })).toHaveCount(0);
  });

  test("owner sees processor management controls on /tools/video-processors", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await page.context().addCookies(playwrightAuthCookies(scenario.owner));

    const response = await page.goto("/tools/video-processors");
    expect(response!.status()).toBeLessThan(500);
    await expect(
      page.getByRole("heading", { name: /^video processors$/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^add$/i })).toBeVisible();
  });
});
