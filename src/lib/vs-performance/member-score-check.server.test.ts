import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listVsHeads: vi.fn(async (): Promise<unknown[]> => []),
  fetchRemoteVsScope: vi.fn(async (): Promise<unknown[]> => []),
  loadVsAllianceLink: vi.fn(),
  resolveVsScoreReadContext: vi.fn(),
  scopeRows: [] as Array<{ managed: Record<string, unknown> }>,
}));

vi.mock("@/lib/vs-scores/repository.server", () => ({
  listVsHeads: mocks.listVsHeads,
}));

vi.mock("@/lib/vs-scores/sync.server", () => ({
  fetchRemoteVsScope: mocks.fetchRemoteVsScope,
}));

vi.mock("@/lib/vs-scores/ashed-transport.server", () => ({
  VsSyncError: class VsSyncError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    schema: actual.schema,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => mocks.scopeRows }),
        }),
      }),
    }),
  };
});

vi.mock("./ashed-opponent-sync.server", () => ({
  loadVsAllianceLink: mocks.loadVsAllianceLink,
  resolveVsScoreReadContext: mocks.resolveVsScoreReadContext,
}));

import { loadVsMemberScoreEvidence } from "./member-score-check.server";

const actor = { sessionId: "s1", hqUserId: "u1", allianceId: "a1" };
const context = {
  connection: { token: "t", appId: "app", originUrl: "o" },
  ashedAllianceId: "ashed-a",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopeRows = [];
  mocks.loadVsAllianceLink.mockResolvedValue({
    ashedAllianceId: "ashed-a",
  });
  mocks.resolveVsScoreReadContext.mockResolvedValue(context);
});

describe("loadVsMemberScoreEvidence", () => {
  it("merges local heads only when the alliance is not linked", async () => {
    mocks.loadVsAllianceLink.mockResolvedValue(null);
    mocks.listVsHeads.mockResolvedValue([
      { memberId: "m1", score: 10, origin: "hq" },
    ]);
    const map = await loadVsMemberScoreEvidence(actor, "2026-09-29");
    expect(map.get("m1")).toBe(10);
    expect(mocks.fetchRemoteVsScope).not.toHaveBeenCalled();
  });

  it("keeps the max score per member across remote rows", async () => {
    mocks.listVsHeads.mockResolvedValue([]);
    mocks.fetchRemoteVsScope.mockResolvedValue([
      { memberId: "m1", score: 5 },
      { memberId: "m1", score: 9 },
      { memberId: "m2", score: 3 },
    ]);
    const map = await loadVsMemberScoreEvidence(actor, "2026-09-29");
    expect(map.get("m1")).toBe(9);
    expect(map.get("m2")).toBe(3);
  });

  it("throws credentials_required when the resolved context mismatches the link", async () => {
    mocks.resolveVsScoreReadContext.mockResolvedValue({
      ...context,
      ashedAllianceId: "other",
    });
    await expect(
      loadVsMemberScoreEvidence(actor, "2026-09-29"),
    ).rejects.toMatchObject({ code: "credentials_required" });
  });

  it("propagates remote read failures instead of reporting a partial sum", async () => {
    mocks.listVsHeads.mockResolvedValue([
      { memberId: "m1", score: 10, origin: "hq" },
    ]);
    mocks.fetchRemoteVsScope.mockRejectedValue(new Error("upstream 500"));
    await expect(
      loadVsMemberScoreEvidence(actor, "2026-09-29"),
    ).rejects.toThrow("upstream 500");
  });

  it("does not let derived local rows outrank upstream evidence", async () => {
    mocks.listVsHeads.mockResolvedValue([
      { memberId: "m1", score: 99, origin: "derived" },
    ]);
    mocks.fetchRemoteVsScope.mockResolvedValue([{ memberId: "m1", score: 4 }]);
    const map = await loadVsMemberScoreEvidence(actor, "2026-09-29");
    expect(map.get("m1")).toBe(4);
  });
});
