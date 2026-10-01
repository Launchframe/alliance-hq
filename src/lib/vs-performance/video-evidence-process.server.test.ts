import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobRows: [] as Record<string, unknown>[],
  claimResults: [] as Record<string, unknown>[][],
  finishCalls: [] as Record<string, unknown>[],
  updateWheres: [] as unknown[],
  claimSets: [] as Record<string, unknown>[],
  loadSession: vi.fn(),
  sessionCanProcessVideoForAlliance: vi.fn(),
  sessionHasPermissionForAlliance: vi.fn(),
  resolveVideoJobAccess: vi.fn(),
  resolveHqAllianceIdFromStoredAllianceId: vi.fn(),
  getObjectStream: vi.fn(),
  parseVsCaptureImageAuto: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === actual.schema.videoJobs ? mocks.jobRows.slice(0, 1) : [],
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          mocks.updateWheres.push(cond);
          return {
            returning: async () => {
              mocks.claimSets.push(set);
              return mocks.claimResults.shift() ?? [];
            },
            then: async (resolve: (v: unknown) => unknown) => {
              mocks.finishCalls.push(set);
              return resolve([]);
            },
          };
        },
      }),
    }),
  };
  return { schema: actual.schema, getDb: () => fakeDb };
});

vi.mock("@/lib/session", () => ({ loadSession: mocks.loadSession }));
vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: mocks.sessionHasPermissionForAlliance,
}));
vi.mock("@/lib/video/video-job-access.server", () => ({
  resolveVideoJobAccess: mocks.resolveVideoJobAccess,
}));
vi.mock("@/lib/video/processor-slots.server", () => ({
  sessionCanProcessVideoForAlliance: mocks.sessionCanProcessVideoForAlliance,
}));
vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId:
    mocks.resolveHqAllianceIdFromStoredAllianceId,
}));
vi.mock("@/lib/storage", () => ({ getObjectStream: mocks.getObjectStream }));
vi.mock("@/lib/vs-performance/video-evidence.server", () => ({
  vsVideoJobReadyForEvidence: (job: {
    approvedAt: unknown;
    status: string;
    parseSessionId: unknown;
  }) =>
    !["pending_upload", "pending_approval", "discarded"].includes(job.status) &&
    (job.approvedAt != null ||
      (job.parseSessionId != null &&
        ["ready", "review", "complete"].includes(job.status))),
  vsVideoScopeKey: (job: { id: string; groupId: string | null }) =>
    job.groupId ? `group:${job.groupId}` : `job:${job.id}`,
}));
vi.mock("@/lib/vs-performance/vs-capture-ocr.server", () => ({
  parseVsCaptureImageAuto: mocks.parseVsCaptureImageAuto,
}));

import { processVsVideoEvidence } from "./video-evidence-process.server";

const job = {
  id: "job-vs-1",
  groupId: "g1",
  scoreTarget: "vs-performance",
  category: "vs-performance",
  status: "queued",
  allianceId: "a1",
  sessionId: "sess-processor",
  processingSessionId: null,
  parseSessionId: null,
  approvedAt: new Date(),
};

const claimed = {
  scopeKey: "group:g1",
  allianceId: "a1",
  status: "queued",
  imageVersion: 2,
  storageKey: "videos/x/sealed",
  imageSha256: "abc",
  requestedKind: "auto",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobRows.length = 0;
  mocks.claimResults.length = 0;
  mocks.finishCalls.length = 0;
  mocks.jobRows.push({ ...job });
  mocks.updateWheres.length = 0;
  mocks.claimSets.length = 0;
  mocks.loadSession.mockResolvedValue({
    id: "sess-processor",
    hqUserId: "u1",
    currentAllianceId: "a1",
    expiresAt: new Date(Date.now() + 3600_000),
  });
  mocks.sessionCanProcessVideoForAlliance.mockResolvedValue(true);
  mocks.sessionHasPermissionForAlliance.mockResolvedValue(true);
  mocks.resolveVideoJobAccess.mockResolvedValue({ ok: true, job });
  mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("a1");
  mocks.claimResults.push([{ ...claimed }]);
  mocks.getObjectStream.mockResolvedValue(new ReadableStream());
});

describe("processVsVideoEvidence", () => {
  it("does not process unapproved, pending, or discarded jobs", async () => {
    for (const status of ["pending_upload", "pending_approval", "discarded"]) {
      mocks.jobRows[0] = { ...job, status, approvedAt: null };
      await processVsVideoEvidence("job-vs-1");
    }
    mocks.jobRows[0] = { ...job, status: "queued", approvedAt: null, parseSessionId: null };
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.claimResults).toHaveLength(1);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("fails closed when the processing session can no longer process", async () => {
    mocks.sessionCanProcessVideoForAlliance.mockResolvedValue(false);
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.claimResults).toHaveLength(1);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("marks a corrupt sealed image failed with capture_invalid", async () => {
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(Buffer.from("not-the-hash"));
          c.close();
        },
      }),
    );
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.finishCalls[0]).toMatchObject({
      status: "failed",
      errorCode: "capture_invalid",
      leaseToken: null,
    });
    expect(mocks.parseVsCaptureImageAuto).not.toHaveBeenCalled();
  });

  it("publishes a ready candidate fenced by lease and generation", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ]);
    const { createHash } = await import("node:crypto");
    mocks.claimResults[0] = [
      { ...claimed, imageSha256: createHash("sha256").update(png).digest("hex") },
    ];
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(png);
          c.close();
        },
      }),
    );
    mocks.parseVsCaptureImageAuto.mockResolvedValue({ kind: "daily_totals" });
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.parseVsCaptureImageAuto).toHaveBeenCalledWith(png, "auto");
    expect(mocks.finishCalls[0]).toMatchObject({
      status: "ready",
      errorCode: null,
      leaseToken: null,
    });
  });

  it("maps capture_kind_unknown to needs_type and other codes to failed", async () => {
    const { VsPerformanceError } = await import(
      "@/lib/vs-performance/weekly-plan.shared"
    );
    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from("abc");
    mocks.claimResults[0] = [
      { ...claimed, imageSha256: createHash("sha256").update(bytes).digest("hex") },
    ];
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    mocks.parseVsCaptureImageAuto.mockRejectedValue(
      new VsPerformanceError("capture_kind_unknown", 422),
    );
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.finishCalls[0]).toMatchObject({
      status: "needs_type",
      errorCode: "capture_kind_unknown",
    });

    mocks.claimResults.push([{ ...claimed }]);
    mocks.parseVsCaptureImageAuto.mockRejectedValue(new Error("boom"));
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.finishCalls[1]).toMatchObject({
      status: "failed",
      errorCode: "capture_failed",
    });
  });

  it("claims at most one row per scope", async () => {
    mocks.claimResults[0] = [];
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
    expect(mocks.finishCalls).toHaveLength(0);
  });

  it("claims only sealed queued or expired-running rows and bumps version atomically", async () => {
    mocks.claimResults[0] = [];
    await processVsVideoEvidence("job-vs-1");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(
      mocks.updateWheres[0] as Parameters<typeof dialect.sqlToQuery>[0],
    );
    expect(sql).toContain('"storage_key" is not null');
    expect(sql).toContain('"image_sha256" is not null');
    expect(sql).toContain('"lease_expires_at"');
    expect(params).toContain("queued");
    expect(params).toContain("running");
    expect(params).not.toContain("failed");
    expect(typeof mocks.claimSets[0]?.version).not.toBe("number");
  });

  it("fences finish on running status, generation, lease token, and live lease", async () => {
    const bytes = Buffer.from("mismatch");
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    await processVsVideoEvidence("job-vs-1");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(
      mocks.updateWheres[1] as Parameters<typeof dialect.sqlToQuery>[0],
    );
    expect(sql).toContain('"image_version" =');
    expect(sql).toContain('"lease_token" =');
    expect(sql).toContain('"lease_expires_at" >');
    expect(params).toContain("running");
    expect(params).toContain(claimed.imageVersion);
    expect(typeof mocks.finishCalls[0]?.version).not.toBe("number");
  });

  it("does not publish when the job was discarded or re-scoped before finish", async () => {
    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from("data");
    mocks.claimResults[0] = [
      { ...claimed, imageSha256: createHash("sha256").update(bytes).digest("hex") },
    ];
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    mocks.parseVsCaptureImageAuto.mockImplementation(async () => {
      mocks.jobRows[0] = { ...job, status: "discarded" };
      return { kind: "daily_totals" };
    });
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.finishCalls).toHaveLength(0);

    mocks.jobRows[0] = { ...job };
    mocks.claimResults.push([{ ...claimed, imageSha256: createHash("sha256").update(bytes).digest("hex") }]);
    mocks.parseVsCaptureImageAuto.mockImplementation(async () => {
      mocks.jobRows[0] = { ...job, groupId: "g2" };
      return { kind: "daily_totals" };
    });
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.finishCalls).toHaveLength(0);
  });

  it("does not publish when processing authorization is revoked before finish", async () => {
    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from("data");
    mocks.claimResults[0] = [
      { ...claimed, imageSha256: createHash("sha256").update(bytes).digest("hex") },
    ];
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    mocks.parseVsCaptureImageAuto.mockImplementation(async () => {
      mocks.sessionCanProcessVideoForAlliance.mockResolvedValue(false);
      return { kind: "daily_totals" };
    });
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.finishCalls).toHaveLength(0);
  });

  it("supports a current officer retrying even after the original processing session expired", async () => {
    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from("data");
    mocks.claimResults[0] = [
      { ...claimed, imageSha256: createHash("sha256").update(bytes).digest("hex") },
    ];
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    mocks.loadSession.mockResolvedValue({
      id: "sess-officer",
      hqUserId: "u2",
      currentAllianceId: "a1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.parseVsCaptureImageAuto.mockResolvedValue({ kind: "daily_totals" });
    await processVsVideoEvidence("job-vs-1", {
      sessionId: "sess-officer",
      hqUserId: "u2",
      allianceId: "a1",
    });
    expect(mocks.resolveVideoJobAccess).toHaveBeenCalledWith(
      "job-vs-1",
      "sess-officer",
      "mutate",
    );
    expect(mocks.sessionCanProcessVideoForAlliance).not.toHaveBeenCalled();
    expect(mocks.finishCalls[0]).toMatchObject({ status: "ready" });
  });

  it("denies override actors with mismatched identity, foreign alliance, or expired sessions", async () => {
    const override = {
      sessionId: "sess-officer",
      hqUserId: "u2",
      allianceId: "a1",
    };
    const deniedSessions = [
      { id: "sess-officer", hqUserId: "other", currentAllianceId: "a1", expiresAt: new Date(Date.now() + 3600_000) },
      { id: "sess-officer", hqUserId: "u2", currentAllianceId: "a2", expiresAt: new Date(Date.now() + 3600_000) },
      { id: "sess-officer", hqUserId: "u2", currentAllianceId: "a1", expiresAt: new Date(Date.now() - 1000) },
      { id: "sess-officer", hqUserId: null, currentAllianceId: "a1", expiresAt: new Date(Date.now() + 3600_000) },
    ];
    for (const s of deniedSessions) {
      mocks.loadSession.mockResolvedValue(s);
      await processVsVideoEvidence("job-vs-1", override);
    }
    mocks.loadSession.mockResolvedValue({
      id: "sess-officer",
      hqUserId: "u2",
      currentAllianceId: "a1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    mocks.resolveVideoJobAccess.mockResolvedValue({ ok: false });
    await processVsVideoEvidence("job-vs-1", override);
    mocks.resolveVideoJobAccess.mockResolvedValue({ ok: true, job });
    mocks.sessionHasPermissionForAlliance.mockResolvedValue(false);
    await processVsVideoEvidence("job-vs-1", override);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
    expect(mocks.claimResults).toHaveLength(1);
  });

  it("denies background processing when the job reverted to pending_approval despite a stale approvedAt", async () => {
    mocks.jobRows[0] = {
      ...job,
      status: "pending_approval",
      approvedAt: new Date(),
    };
    await processVsVideoEvidence("job-vs-1");
    expect(mocks.claimResults).toHaveLength(1);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });
});
