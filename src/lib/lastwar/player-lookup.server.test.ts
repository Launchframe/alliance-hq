import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  lookupPlayerByUidCore,
  notifyLastWarUidLookupOutage,
} = vi.hoisted(() => ({
  lookupPlayerByUidCore: vi.fn(),
  notifyLastWarUidLookupOutage: vi.fn().mockResolvedValue({ sent: true }),
}));

vi.mock("@/lib/lastwar/player-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lastwar/player-lookup")>();
  return {
    ...actual,
    lookupPlayerByUid: lookupPlayerByUidCore,
  };
});

vi.mock("@/lib/lastwar/lookup-outage-alert.server", () => ({
  notifyLastWarUidLookupOutage,
}));

import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup.server";

describe("lookupPlayerByUid (server wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("alerts maintainers on request_failed without changing the result", async () => {
    lookupPlayerByUidCore.mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server.",
    });

    const result = await lookupPlayerByUid("1001369694001203");

    expect(result).toEqual({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server.",
    });
    expect(notifyLastWarUidLookupOutage).toHaveBeenCalledWith({
      detail: "Could not reach the game server.",
    });
  });

  it("does not alert on not_found", async () => {
    lookupPlayerByUidCore.mockResolvedValue({
      ok: false,
      reason: "not_found",
      message: "UID not found",
    });

    await lookupPlayerByUid("1001369694001203");
    expect(notifyLastWarUidLookupOutage).not.toHaveBeenCalled();
  });

  it("does not alert on success", async () => {
    lookupPlayerByUidCore.mockResolvedValue({
      ok: true,
      gameUserName: "Alpha",
      gameServerNumber: 1203,
    });

    await lookupPlayerByUid("1001369694001203");
    expect(notifyLastWarUidLookupOutage).not.toHaveBeenCalled();
  });
});
