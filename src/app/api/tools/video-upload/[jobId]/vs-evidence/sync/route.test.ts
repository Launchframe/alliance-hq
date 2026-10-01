import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const requireApiSession = vi.fn();
const sessionHasPermissionForAlliance = vi.fn();
const resolveVsVideoAccess = vi.fn();
const loadVsVideoEvidence = vi.fn();
const loadVsVideoEvidenceRow = vi.fn();
const retryVsScoresForContext = vi.fn();
const syncAshedOpponentInfo = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => requireApiSession(...args),
}));
vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: (...args: unknown[]) =>
    sessionHasPermissionForAlliance(...args),
}));
vi.mock("@/lib/vs-scores/sync.server", () => ({
  retryVsScoresForContext: (...args: unknown[]) => retryVsScoresForContext(...args),
}));
vi.mock("@/lib/vs-performance/api-helpers.server", () => ({
  vsErrorResponse: (error: { status?: number; code?: string }) =>
    new Response(JSON.stringify({ error: error.code ?? "invalid" }), {
      status: error.status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
}));
vi.mock("@/lib/vs-performance/video-evidence.server", () => ({
  resolveVsVideoAccess: (...args: unknown[]) => resolveVsVideoAccess(...args),
  loadVsVideoEvidence: (...args: unknown[]) => loadVsVideoEvidence(...args),
  loadVsVideoEvidenceRow: (...args: unknown[]) => loadVsVideoEvidenceRow(...args),
}));
vi.mock("@/lib/vs-performance/vs-scope.server", () => ({
  vsScope: () => "scope:week",
}));
vi.mock("@/lib/vs-performance/matchup-sync.server", () => ({
  syncAshedOpponentInfo: (...args: unknown[]) => syncAshedOpponentInfo(...args),
}));

const params = Promise.resolve({ jobId: "job-1" });
const post = (body: unknown) =>
  POST(
    new Request("http://x/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params },
  );

describe("POST .../vs-evidence/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSession.mockResolvedValue({ id: "sess-1", hqUserId: "u1" });
    resolveVsVideoAccess.mockResolvedValue({
      actor: { sessionId: "sess-1", hqUserId: "u1", allianceId: "a1" },
      scopeKey: "job:job-1",
    });
    loadVsVideoEvidenceRow.mockResolvedValue({
      recordedDate: "2026-09-29",
      period: "daily",
    });
    loadVsVideoEvidence.mockResolvedValue({ ashedLinked: false });
    sessionHasPermissionForAlliance.mockResolvedValue(true);
  });

  it("strictly validates the target body", async () => {
    const res = await post({ target: "everything", extra: 1 });
    expect(res.status).toBe(400);
    expect(retryVsScoresForContext).not.toHaveBeenCalled();
  });

  it("retries only the scoped score context with scores:write", async () => {
    const res = await post({ target: "scores" });
    expect(res.status).toBe(200);
    expect(resolveVsVideoAccess).toHaveBeenCalledWith("sess-1", "job-1", "read");
    expect(sessionHasPermissionForAlliance).toHaveBeenCalledWith(
      "sess-1",
      "a1",
      "scores:write",
    );
    expect(retryVsScoresForContext).toHaveBeenCalledWith(
      "a1",
      "2026-09-29",
      "daily",
    );
    expect(syncAshedOpponentInfo).not.toHaveBeenCalled();
  });

  it("denies score sync without scores:write", async () => {
    sessionHasPermissionForAlliance.mockResolvedValue(false);
    const res = await post({ target: "scores" });
    expect(res.status).toBe(403);
    expect(retryVsScoresForContext).not.toHaveBeenCalled();
  });

  it("triggers matchup sync with review access for linked alliances", async () => {
    loadVsVideoEvidenceRow.mockResolvedValue({
      recordedDate: "2026-10-04",
      period: "weekly",
    });
    loadVsVideoEvidence.mockResolvedValue({ ashedLinked: true });
    const res = await post({ target: "matchup" });
    expect(res.status).toBe(200);
    expect(resolveVsVideoAccess).toHaveBeenCalledWith("sess-1", "job-1", "review");
    expect(syncAshedOpponentInfo).toHaveBeenCalledWith(
      { sessionId: "sess-1", hqUserId: "u1", allianceId: "a1" },
      { weekStart: "2026-09-28", scope: "scope:week", reason: "sync" },
      false,
    );
    expect(retryVsScoresForContext).not.toHaveBeenCalled();
  });

  it("is a local no-op for matchup sync on unlinked alliances", async () => {
    const res = await post({ target: "matchup" });
    expect(res.status).toBe(200);
    expect(syncAshedOpponentInfo).not.toHaveBeenCalled();
  });
});
