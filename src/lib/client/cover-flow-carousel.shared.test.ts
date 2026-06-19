import { describe, expect, it } from "vitest";

import {
  coverFlowItemTransform,
  estimateCoverFlowReleaseVelocityPxPerMs,
} from "@/lib/client/cover-flow-carousel.shared";

describe("coverFlowItemTransform", () => {
  it("centers the focused item with full scale", () => {
    const center = coverFlowItemTransform(0);
    expect(center.scale).toBe(1);
    expect(center.opacity).toBe(1);
    expect(center.rotateY).toBe(0);
  });

  it("tilts and shrinks neighbors", () => {
    const next = coverFlowItemTransform(1);
    expect(next.translateX).toBe(60);
    expect(next.rotateY).toBe(-30);
    expect(next.scale).toBeCloseTo(0.85);
  });

  it("accepts custom horizontal spread", () => {
    const next = coverFlowItemTransform(1, 2, 72);
    expect(next.translateX).toBe(72);
  });
});

describe("estimateCoverFlowReleaseVelocityPxPerMs", () => {
  it("returns zero for a single sample", () => {
    expect(
      estimateCoverFlowReleaseVelocityPxPerMs([{ x: 10, t: 100 }]),
    ).toBe(0);
  });
});
