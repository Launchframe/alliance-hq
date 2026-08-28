import { describe, expect, it } from "vitest";

import { buildHeroDayActions } from "@/lib/vs-calculator/planner/hero-day-actions.shared";
import { vsPointsForDiamondPack } from "@/lib/vs-calculator/planner/diamond-pack-ladder.shared";
import { medalsForSkillUpgrade } from "@/lib/vs-calculator/planner/skill-medal-costs.shared";
import { shardsForWeaponUpgrade } from "@/lib/vs-calculator/planner/weapon-shard-costs.shared";
import type { HeroDayPlannerInput } from "@/lib/vs-calculator/planner/planner-types.shared";
import { DEFAULT_HERO_DAY_RATES } from "@/lib/vs-calculator/planner/planner-types.shared";
import { solveHeroDayPlanner } from "@/lib/vs-calculator/planner/hero-day-planner.shared";

function baseInput(
  overrides: Partial<HeroDayPlannerInput> = {},
): HeroDayPlannerInput {
  return {
    currentScore: 6_785_000,
    targetScore: 7_200_000,
    candidates: [
      {
        id: "hero-1",
        label: "Push hero",
        tier: "ur",
        heroLevel: 1,
        skillLevels: [1, 1, 1],
      },
    ],
    bagQuantities: {},
    settings: { spendMode: "free_to_play" },
    ...overrides,
  };
}

describe("skill medal costs", () => {
  it("matches golden medal totals for UR 1→14 and 1→2", () => {
    expect(medalsForSkillUpgrade("ur", 1, 14)).toBe(16_400);
    expect(medalsForSkillUpgrade("ur", 1, 2)).toBe(200);
    expect(16_400 + 200).toBe(16_600);
  });
});

describe("weapon shard costs", () => {
  it("scores L1→10 at 280 upgrade shards", () => {
    expect(shardsForWeaponUpgrade(1, 10)).toBe(280);
    expect(280 * DEFAULT_HERO_DAY_RATES.exclusiveWeaponShardPointsPerUnit).toBe(
      7_000_000,
    );
  });
});

describe("diamond pack ladder", () => {
  it("uses Hero Day diamond rate", () => {
    expect(vsPointsForDiamondPack(500, 30)).toBe(15_000);
    expect(vsPointsForDiamondPack(1_000, 30)).toBe(30_000);
  });
});

describe("buildHeroDayActions spend mode", () => {
  it("omits diamond packs in free-to-play mode", () => {
    const actions = buildHeroDayActions(baseInput());
    expect(actions.some((a) => a.kind === "diamond_pack")).toBe(false);
  });

  it("includes diamond packs in spending mode", () => {
    const actions = buildHeroDayActions(
      baseInput({ settings: { spendMode: "spending" } }),
    );
    expect(actions.filter((a) => a.kind === "diamond_pack").length).toBe(6);
  });
});

describe("solveHeroDayPlanner", () => {
  it("hits golden 415k gap with UR skill upgrades", () => {
    const plan = solveHeroDayPlanner(baseInput(), "exact");
    expect(plan).not.toBeNull();
    expect(plan!.totalPoints).toBe(415_000);
    expect(plan!.projectedScore).toBe(7_200_000);

    const skillActions = plan!.actions.filter((a) => a.kind === "skill_upgrade");
    expect(skillActions).toHaveLength(2);
    expect(skillActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillIndex: 0,
          fromLevel: 1,
          toLevel: 14,
          resourceAmount: 16_400,
        }),
        expect.objectContaining({
          skillIndex: 1,
          fromLevel: 1,
          toLevel: 2,
          resourceAmount: 200,
        }),
      ]),
    );
  });

  it("fills remainder with diamond packs in spending mode", () => {
    const plan = solveHeroDayPlanner(
      baseInput({
        currentScore: 0,
        targetScore: 45_000,
        candidates: [],
        settings: { spendMode: "spending" },
      }),
      "exact",
    );
    expect(plan).not.toBeNull();
    expect(plan!.totalPoints).toBe(45_000);
    expect(plan!.actions.every((a) => a.kind === "diamond_pack")).toBe(true);
  });
});
