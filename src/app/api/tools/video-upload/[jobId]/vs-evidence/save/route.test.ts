import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const requireApiSession = vi.fn();
const resolveVsVideoAccess = vi.fn();
const saveVsVideoMatchOnly = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
}));
vi.mock("@/lib/vs-performance/api-helpers.server", () => ({
  vsErrorResponse: (error: { status?: number; code?: string }) =>
    new Response(JSON.stringify({ error: error.code ?? "internal" }), {
      status: error.status ?? 500,
      headers: { "Content-Type": "application/json" },
    }),
}));
vi.mock("@/lib/vs-performance/video-evidence.server", () => ({
  resolveVsVideoAccess: (...args: unknown[]) => resolveVsVideoAccess(...args),
}));
vi.mock("@/lib/vs-performance/video-evidence-submit.server", () => ({
  saveVsVideoMatchOnly: (...args: unknown[]) => saveVsVideoMatchOnly(...args),
}));

const params = Promise.resolve({ jobId: "job-1" });

describe("POST .../vs-evidence/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue({ id: "sess-1", hqUserId: "u1" });
    resolveVsVideoAccess.mockResolvedValue({ actor: { allianceId: "a1" }, scopeKey: "job:job-1" });
    saveVsVideoMatchOnly.mockResolvedValue({ evidence: {} });
  });

  it("requires an authenticated HQ user", async () => {
    requireApiSession.mockResolvedValue({ id: "sess-1", hqUserId: null });
    const res = await POST(
      new Request("http://x/", { method: "POST", body: "{}" }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(saveVsVideoMatchOnly).not.toHaveBeenCalled();
  });

  it("saves the match with review access and returns the evidence view", async () => {
    const res = await POST(
      new Request("http://x/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: "req-1", submission: {} }),
      }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(resolveVsVideoAccess).toHaveBeenCalledWith("sess-1", "job-1", "review");
    expect(saveVsVideoMatchOnly).toHaveBeenCalledWith(
      { actor: { allianceId: "a1" }, scopeKey: "job:job-1" },
      { requestId: "req-1", submission: {} },
    );
  });
});
