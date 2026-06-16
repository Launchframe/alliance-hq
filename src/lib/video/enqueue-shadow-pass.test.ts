import { describe, expect, it } from "vitest";
import { isShadowEligible } from "@/lib/video/enqueue-shadow-pass";

describe("isShadowEligible", () => {
  it("is eligible for fast primary jobs with few frames", () => {
    const result = isShadowEligible({
      totalMs: 10_000,
      frameCount: 5,
      passRole: "primary",
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
  });

  it("is not eligible for non-primary pass role: shadow", () => {
    const result = isShadowEligible({ totalMs: 5000, frameCount: 3, passRole: "shadow" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_primary");
  });

  it("is not eligible for non-primary pass role: null", () => {
    const result = isShadowEligible({ totalMs: 5000, frameCount: 3, passRole: null });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_primary");
  });

  it("is not eligible when totalMs >= 30000", () => {
    const result = isShadowEligible({ totalMs: 30_000, frameCount: 3, passRole: "primary" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("too_slow");
  });

  it("is not eligible when frameCount >= 12", () => {
    const result = isShadowEligible({ totalMs: 5000, frameCount: 12, passRole: "primary" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("too_many_frames");
  });

  it("is eligible at exactly the boundary (< 30s, < 12 frames)", () => {
    const result = isShadowEligible({ totalMs: 29_999, frameCount: 11, passRole: "primary" });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
  });

  it("prioritizes not_primary check over other conditions", () => {
    const result = isShadowEligible({ totalMs: 99_999, frameCount: 99, passRole: "shadow" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_primary");
  });
});
