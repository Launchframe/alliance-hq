import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const getOrCreateSession = vi.fn();
const resolveVideoJobAccess = vi.fn();
const rematchVideoJobMembers = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: (...args: unknown[]) => getOrCreateSession(...args),
}));

vi.mock("@/lib/video/video-job-access.server", () => ({
  resolveVideoJobAccess: (...args: unknown[]) => resolveVideoJobAccess(...args),
  videoJobAccessErrorResponse: (access: { status: number }) =>
    new Response(JSON.stringify({ error: "denied" }), { status: access.status }),
}));

vi.mock("@/lib/video/rematch-members", () => ({
  rematchVideoJobMembers: (...args: unknown[]) => rematchVideoJobMembers(...args),
}));

const SESSION = { id: "sess-1", hqUserId: "hq-1" };

describe("POST /api/tools/video-upload/[jobId]/rematch-members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSession.mockResolvedValue(SESSION);
  });

  it("returns 409 with connectUrl when Ashed is not connected", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { id: "job-1", status: "review" },
    });
    const { AshedNotConnectedError } = await import("@/lib/video/errors");
    rematchVideoJobMembers.mockRejectedValue(
      new AshedNotConnectedError("Ashed not connected for this session."),
    );

    const res = await POST(new Request("http://localhost/rematch-members"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ashed_not_connected");
    expect(body.connectUrl).toBe(
      "/connect?next=%2Ftools%2Fvideo-upload%2Fjob-1%2Freview",
    );
  });

  it("returns 409 without connectUrl when the alliance is not linked to Ashed", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { id: "job-1", status: "review" },
    });
    const { AllianceNotAshedLinkedError } = await import(
      "@/lib/alliance/ashed-write-guard"
    );
    rematchVideoJobMembers.mockRejectedValue(
      new AllianceNotAshedLinkedError("ally-native-1"),
    );

    const res = await POST(new Request("http://localhost/rematch-members"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALLIANCE_NOT_ASHED_LINKED");
    expect(body.error).toBe("Alliance is not linked to Ashed.");
    expect(body.connectUrl).toBeUndefined();
  });

  it("returns 409 when job is already complete", async () => {
    resolveVideoJobAccess.mockResolvedValue({
      ok: true,
      job: { id: "job-2", status: "complete" },
    });

    const res = await POST(new Request("http://localhost/rematch-members"), {
      params: Promise.resolve({ jobId: "job-2" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Cannot rematch members after scores have been submitted.",
    });
    expect(rematchVideoJobMembers).not.toHaveBeenCalled();
  });

  it("forwards access denial", async () => {
    resolveVideoJobAccess.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(new Request("http://localhost/rematch-members"), {
      params: Promise.resolve({ jobId: "job-x" }),
    });
    expect(res.status).toBe(403);
  });
});
