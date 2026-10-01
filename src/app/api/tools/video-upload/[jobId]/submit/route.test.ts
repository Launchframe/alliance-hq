import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const requireApiSession = vi.fn();
const getAshedConnection = vi.fn();
const resolveVideoJobAccess = vi.fn();
const requireAlliancePermission = vi.fn();
const resolveHqAllianceIdFromStoredAllianceId = vi.fn();
const getAllianceOperatingMode = vi.fn();
const submitFrontlineReview = vi.fn();
const validateFrontlineReview = vi.fn();
const submitVsReview = vi.fn();

const FrontlineReviewErrorStub = vi.hoisted(() => {
  return class extends Error {
    readonly code: string;
    readonly status: number;
    readonly issues: Array<{ id: string; fields: string[] }>;
    constructor(code: string, status = 400, issues: Array<{ id: string; fields: string[] }> = []) {
      super(code);
      this.code = code;
      this.status = status;
      this.issues = issues;
    }
  };
});

vi.mock("@/lib/native-alliance/operating-mode", () => ({
  getAllianceOperatingMode: (...args: unknown[]) =>
    getAllianceOperatingMode(...args),
}));

vi.mock("@/lib/video/frontline-results.server", () => ({
  FrontlineReviewError: FrontlineReviewErrorStub,
  validateFrontlineReview: (...args: unknown[]) =>
    validateFrontlineReview(...args),
}));

vi.mock("@/lib/video/frontline-submit.server", () => ({
  submitFrontlineReview: (...args: unknown[]) => submitFrontlineReview(...args),
  frontlineErrorResponse: (error: { code?: string; status?: number }) =>
    new Response(
      JSON.stringify({
        code: error.code ?? "frontlineSaveFailed",
        error: error.code ?? "frontlineSaveFailed",
        issues: (error as { issues?: unknown[] }).issues ?? [],
      }),
      { status: error.status ?? 500 },
    ),
}));

vi.mock("@/lib/vs-scores/submit.server", () => ({
  submitVsReview: (...args: unknown[]) => submitVsReview(...args),
  vsEvidenceErrorResponse: (error: { code?: string; status?: number }) =>
    new Response(JSON.stringify({ code: error.code ?? "invalid_rows" }), {
      status: error.status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
  getAshedConnection: (...args: unknown[]) => getAshedConnection(...args),
}));

vi.mock("@/lib/video/video-job-access.server", () => ({
  resolveVideoJobAccess: (...args: unknown[]) => resolveVideoJobAccess(...args),
  videoJobAccessErrorResponse: (access: { status: number }) =>
    new Response(JSON.stringify({ error: "denied" }), { status: access.status }),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: (...args: unknown[]) =>
    requireAlliancePermission(...args),
}));

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId: (...args: unknown[]) =>
    resolveHqAllianceIdFromStoredAllianceId(...args),
}));

const dbState = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("@/lib/db", () => {
  // Submit pulls a wide server graph; stub schema columns as string tags.
  const table = new Proxy(
    {},
    {
      get: (_t, prop) => String(prop),
    },
  );
  const schema = new Proxy(
    {},
    {
      get: () => table,
    },
  );
  return {
    getDb: () => dbState.current ?? {},
    schema,
  };
});

const assertAllianceAshedLinked = vi.fn();
const resolveAshedEventId = vi.fn();
const upsertHqEventMemberMetadata = vi.fn();
const listAllianceMembers = vi.fn();
const emitVideoJobStatus = vi.fn();
const writeAuditLog = vi.fn();
const dispatchScoreSubmit = vi.fn();
const getSolicitedEligibility = vi.fn();

vi.mock("@/lib/alliance/ashed-write-guard", () => ({
  AllianceNotAshedLinkedError: class extends Error {},
  assertAllianceAshedLinked: (...args: unknown[]) =>
    assertAllianceAshedLinked(...args),
}));
vi.mock("@/lib/hq-events/provision-ashed", () => ({
  resolveAshedEventId: (...args: unknown[]) => resolveAshedEventId(...args),
  upsertHqEventMemberMetadata: (...args: unknown[]) =>
    upsertHqEventMemberMetadata(...args),
}));
vi.mock("@/lib/members/roster.server", () => ({
  listAllianceMembers: (...args: unknown[]) => listAllianceMembers(...args),
}));
vi.mock("@/lib/events/video-jobs", () => ({
  emitVideoJobStatus: (...args: unknown[]) => emitVideoJobStatus(...args),
}));
vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock("@/lib/video/submit-dispatch", () => ({
  dispatchScoreSubmit: (...args: unknown[]) => dispatchScoreSubmit(...args),
}));
vi.mock("@/lib/feedback/solicited-eligibility", () => ({
  getSolicitedEligibility: (...args: unknown[]) =>
    getSolicitedEligibility(...args),
}));
vi.mock("@/lib/video/ashed-event-provision.server", () => ({
  replaceAshedScoresForContext: vi.fn(),
  resolveOrCreateAshedEvent: vi.fn(),
}));
vi.mock("@/lib/eur/satisfaction", () => ({
  notifyEurVideoEvidence: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/ocr/learning/feedback.server", () => ({
  prepareReviewFeedback: vi.fn(),
  confirmReviewFeedback: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/video/recover-stale-submitting-video-job.server", () => ({
  recoverStaleSubmittingVideoJob: vi.fn(async () => ({ recovered: false })),
}));

const SESSION = { id: "sess-1", hqUserId: "hq-1" };

const REVIEW_JOB = {
  id: "job-1",
  status: "review",
  fileName: "ds.mp4",
  scoreTarget: "desert-storm",
  category: "desert-storm",
  sessionId: "sess-uploader",
  enqueuedByHqUserId: null,
  hqUserId: null,
  allianceId: "ally-1",
  parseSessionId: "parse-1",
};

function scoreSubmitRequest(jobId = "job-1") {
  return new Request(`http://localhost/submit/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordedDate: "2026-07-10",
      rows: [
        {
          id: "row-1",
          memberId: "m-1",
          memberName: "Alpha",
          score: "100",
        },
      ],
    }),
  });
}

describe("POST /api/tools/video-upload/[jobId]/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue(SESSION);
    resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("hq-ally-1");
    requireAlliancePermission.mockResolvedValue(null);
    submitVsReview.mockImplementation(
      async ({ sessionId, job }: { sessionId: string; job: { allianceId: string | null } }) => {
        const allianceId = job.allianceId
          ? await resolveHqAllianceIdFromStoredAllianceId(job.allianceId)
          : null;
        const denied = await requireAlliancePermission(sessionId, allianceId, "scores:write");
        return (
          denied ??
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      },
    );
  });

  it("returns 409 with connectUrl when Ashed is not connected", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: REVIEW_JOB,
    });
    getAshedConnection.mockResolvedValue(null);

    const res = await POST(scoreSubmitRequest("job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ashed_not_connected");
    expect(body.connectUrl).toBe(
      "/connect?next=%2Ftools%2Fvideo-upload%2Fjob-1%2Freview",
    );
    expect(requireAlliancePermission).toHaveBeenCalledWith(
      "sess-1",
      "hq-ally-1",
      "scores:write",
    );
  });

  it("forwards access denial", async () => {
    resolveVideoJobAccess.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(scoreSubmitRequest("job-x"), {
      params: Promise.resolve({ jobId: "job-x" }),
    });
    expect(res.status).toBe(403);
    expect(getAshedConnection).not.toHaveBeenCalled();
    expect(requireAlliancePermission).not.toHaveBeenCalled();
  });

  it("rejects Ashed score submit without scores:write even when job mutate access is allowed", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { ...REVIEW_JOB, scoreTarget: "vs-performance", category: "vs-performance" },
    });
    requireAlliancePermission.mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await POST(scoreSubmitRequest("job-1"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(403);
    expect(requireAlliancePermission).toHaveBeenCalledWith(
      "sess-1",
      "hq-ally-1",
      "scores:write",
    );
    expect(getAshedConnection).not.toHaveBeenCalled();
  });

  it("normalizes numeric deleted flags for VS rows before submitVsReview", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { ...REVIEW_JOB, scoreTarget: "vs-performance", category: "vs-performance" },
    });
    submitVsReview.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const res = await POST(
      new Request("http://localhost/submit/job-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordedDate: "2026-07-10",
          rows: [
            { id: "row-1", memberId: "m-1", memberName: "Alpha", score: "100", deleted: 1 },
            { id: "row-2", memberId: "m-2", memberName: "Beta", score: "200", deleted: "0" },
          ],
        }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(res.status).toBe(200);
    expect(submitVsReview).toHaveBeenCalledOnce();
    const rows = (submitVsReview.mock.calls[0]![0] as { body: { rows: Array<{ id: string; deleted?: boolean }> } }).body.rows;
    expect(rows.find((row) => row.id === "row-1")?.deleted).toBe(true);
    expect(rows.find((row) => row.id === "row-2")?.deleted).toBe(false);
  });

  it("rejects vsMatchReview on non-VS targets with a coded 400", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: REVIEW_JOB,
    });

    const res = await POST(
      new Request("http://localhost/submit/job-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordedDate: "2026-07-10",
          rows: [{ id: "row-1", memberId: "m-1", memberName: "Alpha", score: "100" }],
          vsMatchReview: { source: "manual" },
        }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", code: "invalid" });
    expect(submitVsReview).not.toHaveBeenCalled();
    expect(getAshedConnection).not.toHaveBeenCalled();
  });

  it("forwards vsMatchReview to submitVsReview on vs-performance jobs", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { ...REVIEW_JOB, scoreTarget: "vs-performance", category: "vs-performance" },
    });
    submitVsReview.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const res = await POST(
      new Request("http://localhost/submit/job-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordedDate: "2026-07-10",
          rows: [{ id: "row-1", memberId: "m-1", memberName: "Alpha", score: "100" }],
          vsMatchReview: { source: "manual" },
        }),
      }),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    expect(res.status).toBe(200);
    expect(submitVsReview).toHaveBeenCalledOnce();
    expect(
      (submitVsReview.mock.calls[0]![0] as { body: { vsMatchReview?: unknown } }).body
        .vsMatchReview,
    ).toEqual({ source: "manual" });
  });

  describe("Frontline Breakthrough", () => {
    const FRONTLINE_JOB = {
      ...REVIEW_JOB,
      scoreTarget: "frontline-breakthrough",
      category: "frontline-breakthrough",
    };

    beforeEach(() => {
      resolveVideoJobAccess.mockResolvedValue({ ok: true, job: FRONTLINE_JOB });
      getAllianceOperatingMode.mockResolvedValue("ashed");
    });

    it("rejects malformed row arrays with frontlineInvalidRows before any other work", async () => {
      const res = await POST(
        new Request("http://localhost/submit/job-1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordedDate: "2026-07-10", rows: "nope" }),
        }),
        { params: Promise.resolve({ jobId: "job-1" }) },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "frontlineInvalidRows" });
      expect(requireAlliancePermission).not.toHaveBeenCalled();
      expect(submitFrontlineReview).not.toHaveBeenCalled();
      expect(validateFrontlineReview).not.toHaveBeenCalled();
    });

    it.each([
      { rows: {} },
      { rows: [null] },
      null,
      { rows: [{ id: "row-1", deleted: "yes" }] },
    ])("rejects malformed bodies like %j with no downstream work", async (body) => {
      const res = await POST(
        new Request("http://localhost/submit/job-1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordedDate: "2026-07-10", ...body }),
        }),
        { params: Promise.resolve({ jobId: "job-1" }) },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "frontlineInvalidRows" });
      expect(requireAlliancePermission).not.toHaveBeenCalled();
      expect(submitFrontlineReview).not.toHaveBeenCalled();
      expect(validateFrontlineReview).not.toHaveBeenCalled();
      expect(getAshedConnection).not.toHaveBeenCalled();
    });

    it.each([
      { recordedDate: 42 },
      { hqEventId: {} },
    ])("maps invalid event/date fields like %j via the validator", async (extra) => {
      validateFrontlineReview.mockRejectedValue(
        new FrontlineReviewErrorStub("frontlineInvalidEvent", 400),
      );
      const res = await POST(
        new Request("http://localhost/submit/job-1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordedDate: "2026-07-10",
            ...extra,
            rows: [{ id: "row-1", memberId: "m-1", score: "100", frontlineStage: 5 }],
          }),
        }),
        { params: Promise.resolve({ jobId: "job-1" }) },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "frontlineInvalidEvent" });
      expect(getAshedConnection).not.toHaveBeenCalled();
    });

    it("routes native alliances to submitFrontlineReview after scores:write", async () => {
      getAllianceOperatingMode.mockResolvedValue("native");
      submitFrontlineReview.mockResolvedValue(
        new Response(JSON.stringify({ ok: true, storage: "hq", submitted: 1 }), {
          status: 200,
        }),
      );

      const res = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, storage: "hq", submitted: 1 });
      expect(requireAlliancePermission).toHaveBeenCalledWith(
        "sess-1",
        "hq-ally-1",
        "scores:write",
      );
      expect(submitFrontlineReview).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-1",
          hqUserId: "hq-1",
          job: FRONTLINE_JOB,
        }),
      );
      expect(validateFrontlineReview).not.toHaveBeenCalled();
      expect(getAshedConnection).not.toHaveBeenCalled();
    });

    it("maps native service errors to stable frontline codes", async () => {
      getAllianceOperatingMode.mockResolvedValue("native");
      submitFrontlineReview.mockRejectedValue(
        new FrontlineReviewErrorStub("frontlineInvalidRows", 400, [
          { id: "row-1", fields: ["member"] },
        ]),
      );
      const res = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "frontlineInvalidRows" });

      submitFrontlineReview.mockRejectedValue(new Error("db blew up"));
      const res2 = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res2.status).toBe(500);
      const body = await res2.json();
      expect(body.code).toBe("frontlineSaveFailed");
      expect(body.error).toBe("frontlineSaveFailed");
    });

    it("runs strict validation before Ashed writes for Ashed alliances", async () => {
      validateFrontlineReview.mockResolvedValue({
        eventId: "ev-1",
        recordedDate: "2026-07-10",
        rows: [{ id: "row-1", memberId: "m-1", memberName: "Alpha", score: "100" }],
      });
      getAshedConnection.mockResolvedValue(null);

      const res = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res.status).toBe(409);
      expect(validateFrontlineReview).toHaveBeenCalledWith(
        expect.objectContaining({ job: FRONTLINE_JOB, allianceId: "hq-ally-1" }),
      );
      expect(submitFrontlineReview).not.toHaveBeenCalled();
    });

    it("maps Frontline validation errors instead of touching Ashed", async () => {
      validateFrontlineReview.mockRejectedValue(
        new FrontlineReviewErrorStub("frontlineInvalidRows", 400, [
          { id: "row-1", fields: ["stage"] },
        ]),
      );

      const res = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "frontlineInvalidRows",
        issues: [{ id: "row-1", fields: ["stage"] }],
      });
      expect(getAshedConnection).not.toHaveBeenCalled();
    });

    function chainableDb(rows: unknown[]) {
      const rowsThenable = Object.assign(Promise.resolve(rows), {
        limit: () => rowsThenable,
        orderBy: () => rowsThenable,
        for: () => Promise.resolve(rows),
      });
      const updateResult = Object.assign(Promise.resolve(), {
        returning: () => Promise.resolve([{ id: "job-1" }]),
      });
      return {
        select: () => ({ from: () => ({ where: () => rowsThenable }) }),
        update: () => ({ set: () => ({ where: () => updateResult }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        delete: () => ({ where: () => Promise.resolve() }),
      };
    }

    function seedAshedSuccess() {
      dbState.current = chainableDb([
        {
          id: "row-1",
          parseSessionId: "parse-1",
          ocrName: "Alpha",
          score: "1750",
          rank: 1,
          frontlineStage: 5,
          memberId: "m-1",
          memberName: "Alpha",
          manuallyAdded: 0,
          frameIndex: null,
          deleted: 0,
        },
      ]);
      validateFrontlineReview.mockResolvedValue({
        eventId: "ev-1",
        recordedDate: "2026-07-10",
        rows: [
          {
            id: "row-1",
            memberId: "m-1",
            memberName: "Alpha",
            score: "1750",
            rank: 1,
            frontlineStage: 5,
          },
        ],
      });
      getAshedConnection.mockResolvedValue({ token: "conn" });
      assertAllianceAshedLinked.mockResolvedValue({
        ashedAllianceId: "ashed-al",
      });
      resolveAshedEventId.mockResolvedValue({ ashedEventId: "seasonal-ev" });
      listAllianceMembers.mockResolvedValue([{ ashedMemberId: "m-1" }]);
      getSolicitedEligibility.mockResolvedValue({
        showSolicitedFeedback: false,
        completedUploadCount: 0,
      });
    }

    it("sends numeric SeasonScore remotely and persists stage/rank in HQ metadata", async () => {
      seedAshedSuccess();
      const res = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, submitted: 1 });

      expect(dispatchScoreSubmit).toHaveBeenCalledOnce();
      const payloads = dispatchScoreSubmit.mock.calls[0]![2] as Record<
        string,
        unknown
      >[];
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toEqual({
        alliance_id: "ashed-al",
        event_id: "seasonal-ev",
        member_id: "m-1",
        member_name: "Alpha",
        score: 1750,
        recorded_date: "2026-07-10",
      });

      expect(upsertHqEventMemberMetadata).toHaveBeenCalledWith(
        "ev-1",
        "m-1",
        expect.objectContaining({
          score: 1750,
          rank: 1,
          frontlineStage: 5,
          recordedDate: "2026-07-10",
        }),
      );
      expect(submitFrontlineReview).not.toHaveBeenCalled();
    });

    it("returns frontlineSaveFailed without internals when the remote write fails", async () => {
      seedAshedSuccess();
      dispatchScoreSubmit.mockRejectedValue(new Error("provider exploded"));

      const res = await POST(scoreSubmitRequest("job-1"), {
        params: Promise.resolve({ jobId: "job-1" }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.code).toBe("frontlineSaveFailed");
      expect(body.error).toBe("frontlineSaveFailed");
      expect(upsertHqEventMemberMetadata).not.toHaveBeenCalled();
    });
  });
});
