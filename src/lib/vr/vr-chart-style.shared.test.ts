import { describe, expect, it } from "vitest";

import {
  assignVrChartStyle,
  assignVrChartStyles,
} from "@/lib/vr/vr-chart-style.shared";

describe("VR chart style assignment", () => {
  it("does not duplicate color and shape pairs for 10 distinct ids", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `commander-${index + 1}`);
    const viewerFlags = new Map(ids.map((id) => [id, false]));

    const styles = assignVrChartStyles(ids, viewerFlags);
    const pairs = [...styles.values()].map((style) => `${style.color}:${style.shape}`);

    expect(new Set(pairs).size).toBe(ids.length);
  });

  it("uses solid line for viewer and dashed for others", () => {
    expect(assignVrChartStyle("me", true).dashArray).toBe("");
    expect(assignVrChartStyle("other", false).dashArray).toBe("6 4");
  });
});
