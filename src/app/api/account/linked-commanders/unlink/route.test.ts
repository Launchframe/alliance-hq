import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionIdMock = vi.fn();
const loadSessionMock = vi.fn();
const resolveEffectiveHqUserIdForSessionMock = vi.fn();
const unlinkOwnCommanderClaimMock = vi.fn();

vi.mock("@/lib/session", () => ({
  readSessionId: () => readSessionIdMock(),
  loadSession: (sessionId: string) => loadSessionMock(sessionId),
  resolveEffectiveHqUserIdForSession: (
    sessionId: string,
    hqUserId: string | null,
  ) => resolveEffectiveHqUserIdForSessionMock(sessionId, hqUserId),
}));

vi.mock("@/lib/member-link/unlink.server", () => ({
  unlinkOwnCommanderClaim: (input: unknown) =>
    unlinkOwnCommanderClaimMock(input),
}));

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test/api/account/linked-commanders/unlink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/linked-commanders/unlink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionIdMock.mockResolvedValue("sess-1");
    loadSessionMock.mockResolvedValue({ id: "sess-1", hqUserId: "player-1" });
    resolveEffectiveHqUserIdForSessionMock.mockResolvedValue("player-1");
    unlinkOwnCommanderClaimMock.mockResolvedValue({
      ok: true,
      target: "hq",
      removed: 1,
    });
  });

  it("unlinks the signed-in user's commander", async () => {
    const res = await POST(
      jsonRequest({ allianceId: "a1", ashedMemberId: "m-1" }),
    );
    expect(res.status).toBe(200);
    expect(unlinkOwnCommanderClaimMock).toHaveBeenCalledWith({
      sessionId: "sess-1",
      hqUserId: "player-1",
      allianceId: "a1",
      ashedMemberId: "m-1",
    });
  });

  it("returns 404 when this user does not own the seat", async () => {
    unlinkOwnCommanderClaimMock.mockResolvedValue({
      ok: false,
      reason: "not_linked",
    });
    const res = await POST(
      jsonRequest({ allianceId: "a1", ashedMemberId: "m-1" }),
    );
    expect(res.status).toBe(404);
  });
});
