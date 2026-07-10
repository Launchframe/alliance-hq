import { describe, expect, it } from "vitest";

import {
  assignVrChartStyle,
  assignVrChartStyles,
} from "@/lib/vr/vr-chart-style.shared";

describe("VR chart style assignment", () => {
  it("does not duplicate color and shape pairs for 10 distinct ids", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `commander-${index + 1}`);
    const ranks = new Map(ids.map((id, index) => [id, index + 1]));

    const styles = assignVrChartStyles(ids, ranks);
    const pairs = [...styles.values()].map((style) => `${style.color}:${style.shape}`);

    expect(new Set(pairs).size).toBe(ids.length);
  });

  it("assigns dash patterns by rank", () => {
    expect(assignVrChartStyle("rank-1", 1).dashArray).toBe("");
    expect(assignVrChartStyle("rank-2", 2).dashArray).toBe("8 4");
    expect(assignVrChartStyle("rank-3", 3).dashArray).toBe("2 3");
    expect(assignVrChartStyle("rank-10", 10).dashArray).toBe("2 3");
  });
});
