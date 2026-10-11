import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lastrank/sync-alliance.server", () => ({
  syncLastRankAlliance: vi.fn(),
}));

vi.mock("@/lib/lastrank/sync-upsert.server", () => ({
  listActiveMemberIdsNotInSet: vi.fn(),
}));

import { isLastRankRemoteSyncAuthorized } from "@/lib/lastrank/remote-sync.server";

const token = "a".repeat(64);

function request(authorization?: string): Request {
  return new Request("https://hq.example.com/api/internal/lastrank/remote-sync/plan", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("isLastRankRemoteSyncAuthorized", () => {
  it("accepts the configured bearer token", () => {
    expect(
      isLastRankRemoteSyncAuthorized(request(`Bearer ${token}`), { LASTRANK_SYNC_TOKEN: token }),
    ).toBe(true);
  });

  it("rejects a wrong or missing token", () => {
    const env = { LASTRANK_SYNC_TOKEN: token };
    expect(isLastRankRemoteSyncAuthorized(request(`Bearer ${"b".repeat(64)}`), env)).toBe(false);
    expect(isLastRankRemoteSyncAuthorized(request(token), env)).toBe(false);
    expect(isLastRankRemoteSyncAuthorized(request(), env)).toBe(false);
  });

  it("fails closed when the server token is unset or too short", () => {
    expect(isLastRankRemoteSyncAuthorized(request(`Bearer ${token}`), {})).toBe(false);
    expect(
      isLastRankRemoteSyncAuthorized(request("Bearer short"), { LASTRANK_SYNC_TOKEN: "short" }),
    ).toBe(false);
  });
});
