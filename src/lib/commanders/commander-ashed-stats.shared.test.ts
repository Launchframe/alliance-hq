import { describe, expect, it } from "vitest";

import { commanderStatsFromAshedSnapshot } from "@/lib/commanders/commander-ashed-stats.shared";

describe("commander-ashed-stats.shared", () => {
  it("includes only stat keys explicitly provided on the snapshot input", () => {
    const stats = commanderStatsFromAshedSnapshot(
      { powerLevel: "150.5M" },
      "Alpha",
    );

    expect(stats).toMatchObject({
      primaryName: "Alpha",
      powerLevel: "150.5M",
    });
    expect(stats).not.toHaveProperty("profession");
    expect(stats).not.toHaveProperty("memberLevel");
    expect(stats).not.toHaveProperty("currentKills");
  });

  it("preserves explicit null profession when callers intend to clear it", () => {
    const stats = commanderStatsFromAshedSnapshot(
      { profession: null },
      "Alpha",
    );

    expect(stats).toMatchObject({
      primaryName: "Alpha",
      profession: null,
    });
  });
});
