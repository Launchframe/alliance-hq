import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
  }),
  schema: {
    alliances: {
      id: "id",
      ashedAllianceId: "ashed_alliance_id",
    },
  },
}));

import { resolveHqAllianceIdFromStoredAllianceId } from "./video-job-alliance.server";

describe("resolveHqAllianceIdFromStoredAllianceId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty input", async () => {
    await expect(resolveHqAllianceIdFromStoredAllianceId(null)).resolves.toBeNull();
    await expect(resolveHqAllianceIdFromStoredAllianceId("  ")).resolves.toBeNull();
    expect(selectLimit).not.toHaveBeenCalled();
  });

  it("returns the HQ pk when stored id matches alliances.id", async () => {
    selectLimit.mockResolvedValueOnce([{ id: "hq-1" }]);

    await expect(
      resolveHqAllianceIdFromStoredAllianceId("hq-1"),
    ).resolves.toBe("hq-1");
    expect(selectLimit).toHaveBeenCalledTimes(1);
  });

  it("falls back to ashedAllianceId lookup when pk miss", async () => {
    selectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "hq-roar" }]);

    await expect(
      resolveHqAllianceIdFromStoredAllianceId("6a2dc741baa3dd1031de708e"),
    ).resolves.toBe("hq-roar");
    expect(selectLimit).toHaveBeenCalledTimes(2);
  });

  it("returns null when neither pk nor ashedAllianceId matches", async () => {
    selectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      resolveHqAllianceIdFromStoredAllianceId("unknown-ashed"),
    ).resolves.toBeNull();
  });
});
