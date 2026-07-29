import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  countAllianceSeasonVrReporters: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/vr/repository", () => ({
  countAllianceSeasonVrReporters: mocks.countAllianceSeasonVrReporters,
}));

import { countAllianceVrReporters } from "@/lib/trains/vr-reporter-count.server";

describe("countAllianceVrReporters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
  });

  it("scopes the active-roster season VR reporter count to the effective season", async () => {
    mocks.countAllianceSeasonVrReporters.mockResolvedValue(7);

    await expect(countAllianceVrReporters("a1")).resolves.toBe(7);
    expect(mocks.getEffectiveSeasonForAlliance).toHaveBeenCalledWith("a1");
    expect(mocks.countAllianceSeasonVrReporters).toHaveBeenCalledWith("a1", "3");
  });
});
