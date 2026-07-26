import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const getOrCreateSession = vi.fn();
const getAshedConnection = vi.fn();
const resolveVideoJobAccess = vi.fn();
const requireAlliancePermission = vi.fn();
const resolveHqAllianceIdFromStoredAllianceId = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: (...args: unknown[]) => getOrCreateSession(...args),
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
    getDb: () => ({}),
    schema,
  };
});

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
    getOrCreateSession.mockResolvedValue(SESSION);
    resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("hq-ally-1");
    requireAlliancePermission.mockResolvedValue(null);
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
});
