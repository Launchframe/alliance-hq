import { describe, expect, it } from "vitest";

import {
  MAX_HERO_DAY_CANDIDATES,
  sanitizeHeroDayPushProfile,
} from "@/lib/vs-calculator/planner/push-profile.shared";

describe("sanitizeHeroDayPushProfile", () => {
  it("returns defaults for empty input", () => {
    expect(sanitizeHeroDayPushProfile(null)).toEqual({
      heroes: [],
      plannerSpendMode: "free_to_play",
    });
  });

  it("sanitizes hero candidates and spend mode", () => {
    const result = sanitizeHeroDayPushProfile({
      plannerSpendMode: "spending",
      heroes: [
        {
          id: "h1",
          label: "  Atlas  ",
          tier: "ur",
          heroLevel: 5,
          skillLevels: [1, 2, 3],
          exclusiveWeaponLevel: 2,
        },
        { tier: "invalid" },
      ],
    });

    expect(result.plannerSpendMode).toBe("spending");
    expect(result.heroes).toHaveLength(1);
    expect(result.heroes[0]).toMatchObject({
      id: "h1",
      label: "Atlas",
      tier: "ur",
      heroLevel: 5,
      skillLevels: [1, 2, 3],
      exclusiveWeaponLevel: 2,
    });
  });

  it("caps hero count at MAX_HERO_DAY_CANDIDATES", () => {
    const heroes = Array.from({ length: MAX_HERO_DAY_CANDIDATES + 3 }, (_, i) => ({
      id: `h${i}`,
      label: `Hero ${i}`,
      tier: "sr",
      heroLevel: 1,
      skillLevels: [1, 1, 1],
    }));

    expect(sanitizeHeroDayPushProfile({ heroes }).heroes).toHaveLength(
      MAX_HERO_DAY_CANDIDATES,
    );
  });
});
