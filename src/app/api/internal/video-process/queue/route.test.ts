import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pendingRows: [] as Record<string, unknown>[],
  selectWheres: [] as unknown[],
  queuedJob: null as Record<string, unknown> | null,
  failStaleInFlightVideoJobs: vi.fn(),
  dispatchVideoJobRemote: vi.fn(),
  dispatchVsVideoEvidence: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  let selectIndex = 0;
  const fakeDb = {
    select: () => {
      selectIndex += 1;
      const index = selectIndex;
      return {
        from: () => ({
          innerJoin: () => ({
            where: (cond: unknown) => {
              mocks.selectWheres.push(cond);
              return {
                orderBy: () => ({
                  limit: async () => mocks.pendingRows,
                }),
              };
            },
          }),
          where: () => ({
            orderBy: () => ({
              limit: async () =>
                index > 1 && mocks.queuedJob ? [mocks.queuedJob] : [],
            }),
          }),
        }),
      };
    },
  };
  return { schema: actual.schema, getDb: () => fakeDb, resetSelectIndex: () => {} };
});

vi.mock("@/lib/video/fail-stale-in-flight-video-jobs.server", () => ({
  failStaleInFlightVideoJobs: mocks.failStaleInFlightVideoJobs,
}));
vi.mock("@/lib/video/video-process-dispatch.server", () => ({
  dispatchVideoJobRemote: mocks.dispatchVideoJobRemote,
}));
vi.mock("@/lib/vs-performance/video-evidence-dispatch.server", () => ({
  dispatchVsVideoEvidence: mocks.dispatchVsVideoEvidence,
}));

import { GET } from "./route";

function req() {
  return new Request("http://localhost/api/internal/video-process/queue", {
    headers: { authorization: "Bearer worker-secret" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("VIDEO_WORKER_SECRET", "worker-secret");
  vi.stubEnv("CRON_SECRET", "");
  mocks.pendingRows.length = 0;
  mocks.selectWheres.length = 0;
  mocks.queuedJob = null;
  mocks.failStaleInFlightVideoJobs.mockResolvedValue({ failedJobIds: [] });
  mocks.dispatchVsVideoEvidence.mockResolvedValue(true);
  mocks.dispatchVideoJobRemote.mockResolvedValue({
    ok: true,
    processed: true,
    jobId: "job-1",
    status: "extracting",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("video process queue companion recovery", () => {
  it("selects only sealed, approved, queued or expired-running evidence rows", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(
      mocks.selectWheres[0] as Parameters<typeof dialect.sqlToQuery>[0],
    );
    expect(sql).toContain('"storage_key" is not null');
    expect(sql).toContain('"image_sha256" is not null');
    expect(sql).toContain("not in");
    expect(params).toEqual(
      expect.arrayContaining([
        "pending_upload",
        "pending_approval",
        "discarded",
        "review",
        "complete",
        "queued",
        "running",
      ]),
    );
    expect(params).not.toContain("failed");
    expect(sql).toContain('"approved_at" is not null');
    expect(sql).toContain('"parse_session_id" is not null');
    expect(sql).toContain('"lease_expires_at"');
  });

  it("dispatches pending companions and reports vsEvidenceDispatched", async () => {
    mocks.pendingRows.push({ jobId: "job-a" }, { jobId: "job-b" });
    const res = await GET(req());
    const body = await res.json();
    expect(mocks.dispatchVsVideoEvidence).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchVsVideoEvidence).toHaveBeenCalledWith("job-a");
    expect(mocks.dispatchVsVideoEvidence).toHaveBeenCalledWith("job-b");
    expect(body.vsEvidenceDispatched).toBe(2);
    expect(body.reason).toBe("idle");
  });

  it("keeps the video queue working when companion dispatch fails", async () => {
    mocks.pendingRows.push({ jobId: "job-a" });
    mocks.dispatchVsVideoEvidence.mockRejectedValue(new Error("down"));
    mocks.queuedJob = {
      id: "job-v1",
      fileName: "a.mp4",
      scoreTarget: "vs-performance",
      createdAt: new Date(),
    };
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vsEvidenceDispatched).toBe(0);
    expect(mocks.dispatchVideoJobRemote).toHaveBeenCalledWith("job-v1", {
      source: "cron",
    });
    expect(body.jobId).toBe("job-1");
  });
});
