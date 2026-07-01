import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn(),
}));

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveVrSeasonContext } from "@/lib/vr/repository";

describe("resolveVrSeasonContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISCORD_ALLIANCE_SEASON_KEY;
  });

  it("locks VR updates during post-season and keeps prior season key", async () => {
    vi.mocked(getEffectiveSeasonForAlliance).mockResolvedValue({
      seasonKey: "4",
      source: "cpt-hedge",
      isPostSeason: true,
      week: 7,
      gameServerNumber: 1203,
    });

    await expect(resolveVrSeasonContext("alliance-1")).resolves.toEqual({
      seasonKey: "4",
      isPostSeason: true,
      vrUpdatesLocked: true,
      priorSeason: "4",
    });
  });

  it("allows VR updates during an active season", async () => {
    vi.mocked(getEffectiveSeasonForAlliance).mockResolvedValue({
      seasonKey: "4",
      source: "cpt-hedge",
      isPostSeason: false,
      week: 3,
      gameServerNumber: 1203,
    });

    await expect(resolveVrSeasonContext("alliance-1")).resolves.toEqual({
      seasonKey: "4",
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
    });
  });
});
