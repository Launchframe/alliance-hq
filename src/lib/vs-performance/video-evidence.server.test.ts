import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evidenceRows: [] as Record<string, unknown>[],
  jobRows: [] as Record<string, unknown>[],
  updateCalls: [] as Record<string, unknown>[],
  whereClauses: [] as unknown[],
  insertCalls: 0,
  auditRows: [] as Record<string, unknown>[],
  nextReturning: null as Record<string, unknown>[] | null,
  requireApiSession: undefined as unknown,
  resolveVideoJobAccess: vi.fn(),
  loadSession: vi.fn(),
  sessionHasPermissionForAlliance: vi.fn(),
  resolveHqAllianceIdFromStoredAllianceId: vi.fn(),
  loadVsMatchup: vi.fn(),
  r2Configured: vi.fn(() => false),
  copyObjectBounded: vi.fn(async () => {}),
  getObjectStream: vi.fn(),
  putLocalObjectStreamBounded: vi.fn(async () => ({ bytes: 0, sha256: "" })),
  presignR2PutObject: vi.fn(async () => "https://r2.example/put"),
  sealedBytes: null as Buffer | null,
}));

function applyUpdateValues(
  set: Record<string, unknown>,
): Record<string, unknown>[] {
  mocks.updateCalls.push(set);
  const row = mocks.evidenceRows[0];
  if (!row) return [];
  for (const [key, value] of Object.entries(set)) {
    row[key] =
      key === "version" && typeof value !== "number"
        ? ((row.version as number) ?? 0) + 1
        : value;
  }
  return [row];
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === actual.schema.videoVsEvidence
              ? mocks.evidenceRows.slice(0, 1)
              : table === actual.schema.videoJobs
                ? mocks.jobRows.slice(0, 1)
                : [],
          for: () => ({
            limit: async () =>
              table === actual.schema.videoVsEvidence
                ? mocks.evidenceRows.slice(0, 1)
                : [],
          }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const apply = async () => {
          if (table === actual.schema.auditLog) {
            mocks.auditRows.push(values);
            return true;
          }
          mocks.insertCalls += 1;
          if (!mocks.evidenceRows.some((r) => r.scopeKey === values.scopeKey)) {
            mocks.evidenceRows.push({ version: 1, imageVersion: 0, ...values });
            return true;
          }
          return false;
        };
        return {
          onConflictDoNothing: () => ({
            returning: async () =>
              (await apply()) ? [{ scopeKey: values.scopeKey }] : [],
            then: async (resolve: (v: unknown) => unknown) =>
              resolve(await apply()),
          }),
          then: async (resolve: (v: unknown) => unknown) =>
            resolve(await apply()),
        };
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          mocks.whereClauses.push(cond);
          return {
            returning: async () =>
              mocks.nextReturning !== null
                ? mocks.nextReturning
                : applyUpdateValues(set),
            then: async (resolve: (v: unknown) => unknown) =>
              resolve(applyUpdateValues(set)),
          };
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeDb),
  };
  return { schema: actual.schema, getDb: () => fakeDb };
});

vi.mock("@/lib/session", () => ({
  loadSession: mocks.loadSession,
}));

vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: mocks.sessionHasPermissionForAlliance,
}));

vi.mock("@/lib/video/video-job-access.server", () => ({
  resolveVideoJobAccess: mocks.resolveVideoJobAccess,
}));

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId:
    mocks.resolveHqAllianceIdFromStoredAllianceId,
}));

vi.mock("@/lib/vs-performance/match-results.repository.server", () => ({
  loadVsMatchup: mocks.loadVsMatchup,
}));

vi.mock("@/lib/storage", () => ({
  copyObjectBounded: mocks.copyObjectBounded,
  getObjectStream: mocks.getObjectStream,
  putLocalObjectStreamBounded: mocks.putLocalObjectStreamBounded,
  r2Configured: mocks.r2Configured,
}));

vi.mock("@/lib/storage/r2", () => ({
  presignR2PutObject: mocks.presignR2PutObject,
}));

vi.mock("@/lib/vs-performance/video-evidence-dispatch.server", () => ({
  dispatchVsVideoEvidence: vi.fn(async () => true),
}));

import {
  beginVsVideoImageUpload,
  completeVsVideoImageUpload,
  getVsVideoImage,
  initializeVsVideoEvidence,
  loadVsVideoEvidence,
  removeVsVideoImage,
  requeueVsVideoEvidence,
  resolveVsVideoAccess,
  updateVsVideoEvidence,
  uploadLocalVsVideoImage,
  vsVideoJobReadyForEvidence,
  vsVideoScopeKey,
} from "./video-evidence.server";

const job = {
  id: "job-vs-1",
  groupId: "grp-1",
  scoreTarget: "vs-performance",
  category: "vs-performance",
  status: "queued",
  allianceId: "a1",
  recordedDate: "2026-09-29",
  sessionId: "sess-uploader",
  processingSessionId: null,
  parseSessionId: null,
  approvedAt: new Date("2026-09-29T12:00:00Z"),
};

const session = {
  id: "sess-officer",
  hqUserId: "hq-officer",
  currentAllianceId: "a1",
  allianceId: "a1",
};

function grantPermissions(permissions: Record<string, boolean>) {
  mocks.sessionHasPermissionForAlliance.mockImplementation(
    async (_sessionId: string, _alliance: string, permission: string) =>
      permissions[permission] ?? false,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evidenceRows.length = 0;
  mocks.jobRows.length = 0;
  mocks.nextReturning = null;
  mocks.whereClauses.length = 0;
  mocks.updateCalls.length = 0;
  mocks.insertCalls = 0;
  mocks.auditRows.length = 0;
  mocks.r2Configured.mockReturnValue(false);
  mocks.resolveVideoJobAccess.mockImplementation(async () => ({
    ok: true,
    job: mocks.jobRows[0] ?? job,
  }));
  mocks.loadSession.mockResolvedValue(session);
  mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("a1");
  mocks.loadVsMatchup.mockResolvedValue(null);
  grantPermissions({ "scores:read": true, "hq:video:enqueue": true, "trains:write": true });
});

describe("resolveVsVideoAccess", () => {
  it("scopes to the upload group when present and the job otherwise", () => {
    expect(vsVideoScopeKey({ id: "j1", groupId: "g1" } as never)).toBe("group:g1");
    expect(vsVideoScopeKey({ id: "j1", groupId: null } as never)).toBe("job:j1");
  });

  it("denies non-vs-performance and discarded jobs", async () => {
    mocks.resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { ...job, scoreTarget: "kills" },
    });
    await expect(
      resolveVsVideoAccess("sess-officer", "job-vs-1", "read"),
    ).rejects.toMatchObject({ code: "not_found" });
    mocks.resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { ...job, status: "discarded" },
    });
    await expect(
      resolveVsVideoAccess("sess-officer", "job-vs-1", "read"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("denies a stale active alliance even when job ownership grants read", async () => {
    mocks.loadSession.mockResolvedValue({ ...session, currentAllianceId: "a2" });
    await expect(
      resolveVsVideoAccess("sess-officer", "job-vs-1", "read"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("denies when the canonical alliance cannot be resolved", async () => {
    mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue(null);
    await expect(
      resolveVsVideoAccess("sess-officer", "job-vs-1", "read"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("requires scores:read, hq:video:enqueue, and trains:write per mode", async () => {
    grantPermissions({});
    for (const mode of ["read", "upload", "review"] as const) {
      await expect(
        resolveVsVideoAccess("sess-officer", "job-vs-1", mode),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    grantPermissions({ "scores:read": true });
    await expect(
      resolveVsVideoAccess("sess-officer", "job-vs-1", "read"),
    ).resolves.toMatchObject({ scopeKey: "group:grp-1" });
    await expect(
      resolveVsVideoAccess("sess-officer", "job-vs-1", "review"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("uses job/group access so an authorized reviewer differs from the uploader", async () => {
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    expect(access.actor.hqUserId).toBe("hq-officer");
    expect(access.job.id).toBe("job-vs-1");
  });
});

describe("loadVsVideoEvidence", () => {
  it("returns a version-0 view for a legacy job without a record", async () => {
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "read");
    const response = await loadVsVideoEvidence(access);
    expect(response.evidence).toMatchObject({
      version: 0,
      imageVersion: 0,
      status: "none",
      period: "daily",
      recordedDate: "2026-09-29",
      requestedKind: "auto",
      candidate: null,
      previewUrl: null,
    });
    expect(response.canEditMatch).toBe(true);
    expect(response.alliance).toBeDefined();
  });

  it("never exposes storage keys or lease tokens in the DTO", async () => {
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      jobId: "job-vs-1",
      recordedDate: "2026-09-29",
      period: "daily",
      version: 3,
      imageVersion: 2,
      requestedKind: "auto",
      status: "ready",
      storageKey: "videos/x/sealed",
      uploadKey: "videos/x/incoming",
      leaseToken: "secret-lease",
      candidate: { kind: "daily_totals" },
      draft: null,
      errorCode: null,
      appliedImageVersion: null,
      fileName: "shot.png",
      contentType: "image/png",
    });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "read");
    const response = await loadVsVideoEvidence(access);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("videos/x");
    expect(serialized).not.toContain("secret-lease");
    expect(response.evidence.previewUrl).toContain("/vs-evidence/image");
    expect(response.evidence.previewUrl).toContain("imageVersion=2");
  });

  it("hides the preview URL while the capture kind is unknown", async () => {
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      jobId: "job-vs-1",
      recordedDate: "2026-09-29",
      period: "daily",
      version: 3,
      imageVersion: 2,
      requestedKind: "auto",
      status: "queued",
      storageKey: "videos/x/sealed",
      candidate: null,
      draft: null,
      errorCode: null,
      appliedImageVersion: null,
      fileName: "shot.png",
      contentType: "image/png",
    });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "read");
    const response = await loadVsVideoEvidence(access);
    expect(response.evidence.previewUrl).toBeNull();
  });
});

describe("updateVsVideoEvidence", () => {
  const baseRow = {
    scopeKey: "group:grp-1",
    allianceId: "a1",
    jobId: "job-vs-1",
    recordedDate: "2026-09-29",
    period: "daily",
    version: 4,
    imageVersion: 2,
    requestedKind: "auto",
    status: "ready",
    storageKey: "videos/x/sealed",
    uploadKey: null,
    candidate: { kind: "daily_totals" },
    draft: { includeResults: true, submission: null },
    errorCode: null,
    appliedImageVersion: 2,
    leaseToken: "t",
    leaseExpiresAt: new Date(),
  };

  it("rejects a mismatched expectedVersion", async () => {
    mocks.evidenceRows.push({ ...baseRow });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    await expect(
      updateVsVideoEvidence(access, { expectedVersion: 3, draft: null }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("creates a row for legacy jobs only with expectedVersion 0", async () => {
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await expect(
      updateVsVideoEvidence(access, {
        expectedVersion: 1,
        context: { recordedDate: "2026-09-28", period: "daily" },
      }),
    ).rejects.toMatchObject({ code: "stale" });
    const response = await updateVsVideoEvidence(access, {
      expectedVersion: 0,
      context: { recordedDate: "2026-09-28", period: "daily" },
    });
    expect(response.evidence.version).toBe(1);
    expect(response.evidence.recordedDate).toBe("2026-09-28");
  });

  it("clears draft and invalidates OCR generation when context changes", async () => {
    mocks.evidenceRows.push({ ...baseRow });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    const response = await updateVsVideoEvidence(access, {
      expectedVersion: 4,
      context: { recordedDate: "2026-09-28", period: "daily" },
    });
    expect(response.evidence.version).toBe(5);
    expect(response.evidence.imageVersion).toBe(3);
    expect(response.evidence.draft).toBeNull();
    expect(response.evidence.candidate).not.toBeNull();
    expect(mocks.updateCalls[0].leaseToken).toBeNull();
    expect(mocks.updateCalls[0].appliedImageVersion).toBeNull();
  });

  it("requeues the sealed image only when requestedKind actually changes", async () => {
    mocks.evidenceRows.push({ ...baseRow });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    const response = await updateVsVideoEvidence(access, {
      expectedVersion: 4,
      requestedKind: "weekly_overview",
    });
    expect(response.evidence.status).toBe("queued");
    expect(response.evidence.candidate).toBeNull();
  });

  it("requeues a running sealed row on context change instead of lease-limbo", async () => {
    mocks.evidenceRows.push({ ...baseRow, status: "running" });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    const response = await updateVsVideoEvidence(access, {
      expectedVersion: 4,
      context: { recordedDate: "2026-09-28", period: "daily" },
    });
    expect(response.evidence.status).toBe("queued");
    expect(response.evidence.candidate).toBeNull();
    expect(mocks.updateCalls[0].leaseExpiresAt).toBeNull();
  });

  it("invalidates an in-flight upload on context change and fences its completion", async () => {
    mocks.evidenceRows.push({
      ...baseRow,
      status: "uploading",
      storageKey: null,
      uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
      imageSha256: null,
    });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    const response = await updateVsVideoEvidence(access, {
      expectedVersion: 4,
      context: { recordedDate: "2026-09-28", period: "daily" },
    });
    expect(response.evidence.status).toBe("none");
    const call = mocks.updateCalls[0];
    for (const key of [
      "uploadKey",
      "storageKey",
      "imageSha256",
      "fileName",
      "contentType",
      "fileSize",
      "candidate",
    ]) {
      expect(call[key]).toBeNull();
    }
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
          c.close();
        },
      }),
    );
    await expect(
      completeVsVideoImageUpload(access, { imageVersion: 2 }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("audits officer draft saves without leaking form contents", async () => {
    mocks.evidenceRows.push({ ...baseRow });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    await updateVsVideoEvidence(access, {
      expectedVersion: 4,
      draft: { includeResults: true, submission: null },
    });
    const audit = mocks.auditRows.find(
      (row) => row.action === "vs.video_review_draft",
    );
    expect(audit).toMatchObject({
      sessionId: "sess-officer",
      allianceId: "a1",
      hqUserId: "hq-officer",
      severity: "routine",
      resourceType: "video_job",
      resourceId: "job-vs-1",
      metadata: {
        permission: "trains:write",
        imageVersion: 2,
        hasDraft: true,
      },
    });
    expect(
      JSON.stringify(audit?.metadata),
    ).not.toContain("form");
  });

  it("rejects a draft submitted alongside a context or kind change", async () => {
    mocks.evidenceRows.push({ ...baseRow });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    await expect(
      updateVsVideoEvidence(access, {
        expectedVersion: 4,
        context: { recordedDate: "2026-09-28", period: "daily" },
        draft: { includeResults: true, submission: null },
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      updateVsVideoEvidence(access, {
        expectedVersion: 4,
        requestedKind: "weekly_overview",
        draft: { includeResults: true, submission: null },
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    const cleared = await updateVsVideoEvidence(access, {
      expectedVersion: 4,
      context: { recordedDate: "2026-09-28", period: "daily" },
      draft: null,
    });
    expect(cleared.evidence.version).toBe(5);
  });

  it("rejects a draft submission pinned to an old row version", async () => {
    mocks.evidenceRows.push({ ...baseRow });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "review");
    await expect(
      updateVsVideoEvidence(access, {
        expectedVersion: 4,
        draft: {
          includeResults: true,
          submission: {
            evidenceVersion: 3,
            expectedMatchupVersion: 0,
            expectedDayVersions: {},
            editOpponent: false,
            data: { source: "manual" },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });
});

describe("image upload lifecycle", () => {
  it("rejects oversize, wrong mime, and forged versions at init", async () => {
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await expect(
      beginVsVideoImageUpload(access, {
        expectedVersion: 0,
        fileName: "a.png",
        fileSize: 21 * 1024 * 1024,
        contentType: "image/png",
      }),
    ).rejects.toThrow();
    await expect(
      beginVsVideoImageUpload(access, {
        expectedVersion: 0,
        fileName: "a.gif",
        fileSize: 100,
        contentType: "image/gif",
      }),
    ).rejects.toThrow();
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 7,
      imageVersion: 2,
      status: "none",
      recordedDate: "2026-09-29",
      period: "daily",
    });
    await expect(
      beginVsVideoImageUpload(access, {
        expectedVersion: 3,
        fileName: "a.png",
        fileSize: 100,
        contentType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("creates the record and bumps generation in direct mode", async () => {
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    const result = await beginVsVideoImageUpload(access, {
      expectedVersion: 0,
      fileName: "shot.png",
      fileSize: 500,
      contentType: "image/png",
    });
    expect(result.mode).toBe("direct");
    expect(result.imageVersion).toBe(1);
    expect(result.version).toBe(2);
    const row = mocks.evidenceRows[0];
    expect(row.status).toBe("uploading");
    expect(String(row.uploadKey)).toMatch(
      /^videos\/job-vs-1\/vs-match\/.+\/incoming$/,
    );
    expect(String(row.uploadKey)).not.toContain("sealed");
    expect(row.storageKey).toBeNull();
  });

  it("never presigns the sealed key in r2 mode", async () => {
    mocks.r2Configured.mockReturnValue(true);
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    const result = await beginVsVideoImageUpload(access, {
      expectedVersion: 0,
      fileName: "shot.png",
      fileSize: 500,
      contentType: "image/png",
    });
    expect(result.mode).toBe("r2_put");
    const presigned = String(mocks.presignR2PutObject.mock.calls.flat()[0]);
    expect(presigned).toContain("/incoming");
    expect(presigned).not.toContain("/sealed");
  });

  it("refuses app-proxy upload when R2 is configured", async () => {
    mocks.r2Configured.mockReturnValue(true);
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await expect(
      uploadLocalVsVideoImage(
        access,
        1,
        new ReadableStream({ start: (c) => c.close() }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects completion for the wrong generation or a bad image", async () => {
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 2,
      imageVersion: 1,
      status: "uploading",
      jobId: "job-vs-1",
      uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
      fileSize: 3,
      recordedDate: "2026-09-29",
      period: "daily",
    });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await expect(
      completeVsVideoImageUpload(access, { imageVersion: 9 }),
    ).rejects.toMatchObject({ code: "stale" });
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(Buffer.from("GIF89"));
          c.close();
        },
      }),
    );
    await expect(
      completeVsVideoImageUpload(access, { imageVersion: 1 }),
    ).rejects.toMatchObject({ code: "capture_invalid" });
    expect(mocks.evidenceRows[0].status).toBe("failed");
    expect(mocks.evidenceRows[0].errorCode).toBe("capture_invalid");
  });

  it("seals, hashes, and queues a valid PNG without leaking the image version to other writers", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 2,
      imageVersion: 1,
      status: "uploading",
      jobId: "job-vs-1",
      uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
      fileSize: png.length,
      contentType: "image/png",
      recordedDate: "2026-09-29",
      period: "daily",
    });
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(png);
          c.close();
        },
      }),
    );
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    const response = await completeVsVideoImageUpload(access, {
      imageVersion: 1,
    });
    expect(response.evidence.status).toBe("queued");
    const sealedDest = String(
      (mocks.copyObjectBounded.mock.calls[0] as unknown[])[1],
    );
    expect(mocks.copyObjectBounded).toHaveBeenCalledWith(
      "videos/job-vs-1/vs-match/abc/incoming",
      expect.stringMatching(/^videos\/job-vs-1\/vs-match\/.+\/sealed$/),
      expect.any(Number),
    );
    expect(sealedDest).not.toBe("videos/job-vs-1/vs-match/abc/sealed");
    expect(JSON.stringify(response)).not.toContain(sealedDest);
  });

  it("allocates a fresh sealed destination for each completion attempt", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    mocks.getObjectStream.mockImplementation(
      async () =>
        new ReadableStream({
          start: (c) => {
            c.enqueue(png);
            c.close();
          },
        }),
    );
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    const destinations: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      mocks.evidenceRows[0] = {
        scopeKey: "group:grp-1",
        allianceId: "a1",
        version: 2,
        imageVersion: 1,
        status: "uploading",
        uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
        fileSize: png.length,
        contentType: "image/png",
        recordedDate: "2026-09-29",
        period: "daily",
      };
      await completeVsVideoImageUpload(access, { imageVersion: 1 });
      destinations.push(
        String((mocks.copyObjectBounded.mock.calls[attempt] as unknown[])[1]),
      );
    }
    expect(destinations[0]).not.toBe(destinations[1]);
  });

  it("increments version atomically rather than writing a captured row version", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 9,
      imageVersion: 1,
      status: "uploading",
      jobId: "job-vs-1",
      uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
      fileSize: png.length,
      contentType: "image/png",
      recordedDate: "2026-09-29",
      period: "daily",
    });
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(png);
          c.close();
        },
      }),
    );
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await completeVsVideoImageUpload(access, { imageVersion: 1 });
    const publish = mocks.updateCalls.at(-1)!;
    expect(typeof publish.version).not.toBe("number");
    expect(mocks.evidenceRows[0].version).toBe(10);
  });

  it("rejects publication when the caller was revoked before publish", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 2,
      imageVersion: 1,
      status: "uploading",
      jobId: "job-vs-1",
      uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
      fileSize: png.length,
      contentType: "image/png",
      recordedDate: "2026-09-29",
      period: "daily",
    });
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(png);
          c.close();
        },
      }),
    );
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    mocks.loadSession.mockResolvedValue({ ...session, currentAllianceId: "a2" });
    await expect(
      completeVsVideoImageUpload(access, { imageVersion: 1 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.evidenceRows[0].status).toBe("uploading");
    expect(mocks.evidenceRows[0].storageKey).toBeUndefined();
  });

  it("rejects partial PNG signatures and MIME mismatches, accepts real PNG and JPEG magic", async () => {
    const cases: { bytes: Buffer; contentType: string; ok: boolean }[] = [
      {
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]),
        contentType: "image/png",
        ok: false,
      },
      {
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: "image/jpeg",
        ok: false,
      },
      {
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: "image/png",
        ok: true,
      },
      {
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
        contentType: "image/jpeg",
        ok: true,
      },
    ];
    for (const { bytes, contentType, ok } of cases) {
      mocks.evidenceRows[0] = {
        scopeKey: "group:grp-1",
        allianceId: "a1",
        version: 2,
        imageVersion: 1,
        status: "uploading",
        uploadKey: "videos/job-vs-1/vs-match/abc/incoming",
        fileSize: bytes.length,
        contentType,
        recordedDate: "2026-09-29",
        period: "daily",
      };
      mocks.getObjectStream.mockResolvedValue(
        new ReadableStream({
          start: (c) => {
            c.enqueue(bytes);
            c.close();
          },
        }),
      );
      const access = await resolveVsVideoAccess(
        "sess-officer",
        "job-vs-1",
        "upload",
      );
      if (ok) {
        const response = await completeVsVideoImageUpload(access, {
          imageVersion: 1,
        });
        expect(response.evidence.status).toBe("queued");
      } else {
        await expect(
          completeVsVideoImageUpload(access, { imageVersion: 1 }),
        ).rejects.toMatchObject({ code: "capture_invalid" });
        expect(mocks.evidenceRows[0].status).toBe("failed");
      }
    }
  });

  it("does not publish a stale completion over a newer generation", async () => {
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 5,
      imageVersion: 2,
      status: "uploading",
      jobId: "job-vs-1",
      uploadKey: "videos/job-vs-1/vs-match/new/incoming",
      fileSize: 8,
      contentType: "image/png",
      recordedDate: "2026-09-29",
      period: "daily",
    });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ]);
    mocks.getObjectStream.mockResolvedValue(
      new ReadableStream({
        start: (c) => {
          c.enqueue(png);
          c.close();
        },
      }),
    );
    mocks.nextReturning = [];
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await expect(
      completeVsVideoImageUpload(access, { imageVersion: 2 }),
    ).rejects.toMatchObject({ code: "stale" });
    expect(mocks.evidenceRows[0].status).toBe("uploading");
  });
});

describe("removeVsVideoImage and getVsVideoImage", () => {
  it("logically removes only this attachment and keeps sealed provenance", async () => {
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 4,
      imageVersion: 2,
      status: "ready",
      storageKey: "videos/x/sealed",
      fileName: "a.png",
      candidate: { kind: "daily_totals" },
      draft: { includeResults: true, submission: null },
      recordedDate: "2026-09-29",
      period: "daily",
    });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await expect(removeVsVideoImage(access, 3)).rejects.toMatchObject({
      code: "stale",
    });
    const response = await removeVsVideoImage(access, 4);
    expect(response.evidence.status).toBe("none");
    expect(response.evidence.imageVersion).toBe(3);
    expect(response.evidence.draft).toBeNull();
    expect(response.evidence.previewUrl).toBeNull();
    expect(mocks.evidenceRows[0].storageKey).toBeNull();
    await expect(getVsVideoImage(access)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("requeue requires a sealed image and only applies to finished statuses", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 4,
      imageVersion: 2,
      status: "none",
      recordedDate: "2026-09-29",
      period: "daily",
    });
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "upload");
    await requeueVsVideoEvidence(access);
    expect(mocks.updateCalls.at(-1)!.version).not.toBe(5);
    const { sql, params } = dialect.sqlToQuery(
      mocks.whereClauses.at(-1) as Parameters<typeof dialect.sqlToQuery>[0],
    );
    expect(sql).toContain('"storage_key" is not null');
    expect(sql).toContain('"image_sha256" is not null');
    expect(sql).toContain('"status" in');
    expect(params).toEqual(expect.arrayContaining(["ready", "needs_type", "failed"]));
    expect(params).not.toContain("uploading");
    expect(params).not.toContain("queued");
  });

  it("requires an existing sealed image for preview", async () => {
    const access = await resolveVsVideoAccess("sess-officer", "job-vs-1", "read");
    await expect(getVsVideoImage(access)).rejects.toMatchObject({
      code: "not_found",
    });
    mocks.evidenceRows.push({
      scopeKey: "group:grp-1",
      allianceId: "a1",
      version: 4,
      imageVersion: 2,
      status: "ready",
      storageKey: "videos/x/sealed",
      contentType: "image/jpeg",
      candidate: { kind: "daily_totals" },
      recordedDate: "2026-09-29",
      period: "daily",
    });
    mocks.getObjectStream.mockResolvedValue(new ReadableStream());
    const image = await getVsVideoImage(access);
    expect(image.kind).toBe("daily_totals");
    expect(image.imageVersion).toBe(2);
    await expect(getVsVideoImage(access, 1)).rejects.toMatchObject({
      code: "stale",
    });
    mocks.evidenceRows[0].requestedKind = "auto";
    mocks.evidenceRows[0].candidate = null;
    await expect(getVsVideoImage(access)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("initializeVsVideoEvidence", () => {
  it("persists the selected context without duplicating records", async () => {
    mocks.jobRows.push({ ...job, id: "job-init-1", groupId: null });
    await initializeVsVideoEvidence("job-init-1", "sess-uploader", {
      recordedDate: "2026-10-04",
      period: "weekly",
    });
    expect(mocks.evidenceRows).toHaveLength(1);
    expect(mocks.evidenceRows[0]).toMatchObject({
      scopeKey: "job:job-init-1",
      allianceId: "a1",
      recordedDate: "2026-10-04",
      period: "weekly",
    });
    await initializeVsVideoEvidence("job-init-1", "sess-uploader", {
      recordedDate: "2026-09-29",
      period: "daily",
    });
    expect(mocks.evidenceRows).toHaveLength(1);
    expect(mocks.evidenceRows[0].recordedDate).toBe("2026-10-04");
  });

  it("defaults a legacy Sunday recorded date to a weekly period", async () => {
    mocks.jobRows.push({
      ...job,
      id: "job-init-sun",
      groupId: null,
      recordedDate: "2026-10-04",
    });
    await initializeVsVideoEvidence("job-init-sun", "sess-uploader");
    expect(mocks.evidenceRows[0]).toMatchObject({
      recordedDate: "2026-10-04",
      period: "weekly",
    });
    mocks.jobRows[0] = {
      ...job,
      id: "job-init-tue",
      groupId: null,
      recordedDate: "2026-09-29",
    };
    await initializeVsVideoEvidence("job-init-tue", "sess-uploader");
    expect(mocks.evidenceRows[1]).toMatchObject({
      recordedDate: "2026-09-29",
      period: "daily",
    });
  });

  it("validates supplied context and fails closed on stale alliances", async () => {
    mocks.jobRows.push({ ...job, id: "job-init-ctx", groupId: null });
    await expect(
      initializeVsVideoEvidence("job-init-ctx", "sess-uploader", {
        recordedDate: "2026-09-28",
        period: "weekly",
      }),
    ).rejects.toThrow();
    mocks.loadSession.mockResolvedValue({ ...session, currentAllianceId: "a2" });
    await expect(
      initializeVsVideoEvidence("job-init-ctx", "sess-uploader"),
    ).rejects.toMatchObject({ code: "forbidden" });
    mocks.loadSession.mockResolvedValue(session);
    mocks.resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue(null);
    await expect(
      initializeVsVideoEvidence("job-init-ctx", "sess-uploader"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.evidenceRows).toHaveLength(0);
  });

  it("skips non-vs-performance jobs without creating records", async () => {
    mocks.jobRows.push({ ...job, scoreTarget: "kills" });
    await initializeVsVideoEvidence("job-init-1", "sess-uploader");
    expect(mocks.evidenceRows).toHaveLength(0);
  });

  it("qualifies approved and legacy review jobs for processing only", () => {
    const base = { approvedAt: null, status: "queued", parseSessionId: null };
    const asJob = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as never;
    expect(vsVideoJobReadyForEvidence(asJob({ status: "pending_upload" }))).toBe(false);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "pending_approval" }))).toBe(false);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "pending_upload", approvedAt: new Date() }))).toBe(false);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "pending_approval", approvedAt: new Date() }))).toBe(false);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "discarded", approvedAt: new Date() }))).toBe(false);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "queued" }))).toBe(false);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "review", parseSessionId: "ps1" }))).toBe(true);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "complete", parseSessionId: "ps1" }))).toBe(true);
    expect(vsVideoJobReadyForEvidence(asJob({ status: "queued", approvedAt: new Date() }))).toBe(true);
  });
});
