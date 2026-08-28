import { describe, expect, it } from "vitest";

import { VS_CATALOG_SEED_ITEMS } from "@/lib/vs-calculator/catalog-seed.shared";
import {
  catalogDefsForDay,
  lineScoreForItem,
  sumCapacityForDay,
} from "@/lib/vs-calculator/capacity.shared";

const defs = VS_CATALOG_SEED_ITEMS.map((item) => ({
  slug: item.slug,
  displayName: item.displayName,
  pointsByDay: item.pointsByDay,
  sortOrder: item.sortOrder,
}));

describe("sumCapacityForDay", () => {
  it("sums qty × points for the active day only", () => {
    const total = sumCapacityForDay(
      1,
      { drone_part: 2, diamond: 10, train_unit_lv6: 5 },
      defs,
    );
    expect(total).toBe(2 * 6250 + 10 * 30);
  });

  it("scores Lv.6 unit training on day 5 at 210 per unit", () => {
    expect(
      sumCapacityForDay(5, { train_unit_lv6: 3 }, defs),
    ).toBe(630);
    expect(lineScoreForItem(1, 210)).toBe(210);
  });

  it("scores Lv.7 drone chest on day 3 at 2,025,000 per chest", () => {
    expect(
      sumCapacityForDay(3, { drone_chest_l7: 2 }, defs),
    ).toBe(4050000);
  });
});

describe("catalogDefsForDay", () => {
  it("excludes items with zero points on that day", () => {
    const day1 = catalogDefsForDay(1, defs);
    expect(day1.some((d) => d.slug === "train_unit_lv6")).toBe(false);
    expect(day1.some((d) => d.slug === "drone_part")).toBe(true);
  });
});
