import { describe, expect, it } from "vitest";

import {
  followMeObserverRootMargin,
  followMeViewportCenterY,
  interpolateSecondsAtCenter,
} from "@/lib/video/follow-me-row";

describe("interpolateSecondsAtCenter", () => {
  it("returns null when there are no usable samples", () => {
    expect(interpolateSecondsAtCenter([], 400)).toBeNull();
    expect(
      interpolateSecondsAtCenter(
        [{ seconds: Number.NaN, centerPx: 100 }],
        400,
      ),
    ).toBeNull();
  });

  it("clamps to the first anchor when the center is above all anchors", () => {
    const samples = [
      { seconds: 5, centerPx: 200 },
      { seconds: 6, centerPx: 260 },
    ];
    expect(interpolateSecondsAtCenter(samples, 100)).toBe(5);
  });

  it("clamps to the last anchor when the center is below all anchors", () => {
    const samples = [
      { seconds: 5, centerPx: 200 },
      { seconds: 6, centerPx: 260 },
    ];
    expect(interpolateSecondsAtCenter(samples, 999)).toBe(6);
  });

  it("linearly interpolates between bracketing anchors", () => {
    const samples = [
      { seconds: 10, centerPx: 100 },
      { seconds: 14, centerPx: 300 },
    ];
    // Center 25% between the two anchors → 10 + 0.25 * (14 - 10) = 11.
    expect(interpolateSecondsAtCenter(samples, 150)).toBeCloseTo(11, 5);
    // Halfway → 12.
    expect(interpolateSecondsAtCenter(samples, 200)).toBeCloseTo(12, 5);
  });

  it("sorts samples by position before interpolating (order-independent)", () => {
    const samples = [
      { seconds: 14, centerPx: 300 },
      { seconds: 10, centerPx: 100 },
    ];
    expect(interpolateSecondsAtCenter(samples, 200)).toBeCloseTo(12, 5);
  });

  it("interpolates downward (later rows can map to earlier frames)", () => {
    const samples = [
      { seconds: 8, centerPx: 100 },
      { seconds: 2, centerPx: 200 },
    ];
    expect(interpolateSecondsAtCenter(samples, 150)).toBeCloseTo(5, 5);
  });

  it("floors interpolated time at 0 and falls back to a single anchor", () => {
    expect(
      interpolateSecondsAtCenter([{ seconds: 7, centerPx: 150 }], 9999),
    ).toBe(7);
    expect(
      interpolateSecondsAtCenter(
        [
          { seconds: -3, centerPx: 100 },
          { seconds: 4, centerPx: 100 },
        ],
        100,
      ),
    ).toBe(0);
  });
});

describe("followMeObserverRootMargin", () => {
  it("insets top for the sticky header by default", () => {
    expect(
      followMeObserverRootMargin({
        previewOpen: false,
        placement: "side",
        dockHeightPx: 400,
      }),
    ).toBe("-52px 0px 0px 0px");
  });

  it("insets top and bottom when top and bottom docks are open", () => {
    expect(
      followMeObserverRootMargin({
        previewOpen: true,
        placement: "top",
        dockHeightPx: 400,
      }),
    ).toBe("-452px 0px 0px 0px");

    expect(
      followMeObserverRootMargin({
        previewOpen: true,
        placement: "bottom",
        dockHeightPx: 400,
      }),
    ).toBe("-52px 0px -400px 0px");
  });
});

describe("followMeViewportCenterY", () => {
  it("centers within the visible band below header-only inset", () => {
    expect(
      followMeViewportCenterY({
        viewportHeight: 800,
        previewOpen: false,
        placement: "side",
        dockHeightPx: 400,
      }),
    ).toBe(52 + (800 - 52) / 2);
  });

  it("centers within the band above a bottom dock", () => {
    const dockHeightPx = 400;
    expect(
      followMeViewportCenterY({
        viewportHeight: 800,
        previewOpen: true,
        placement: "bottom",
        dockHeightPx,
      }),
    ).toBe(52 + (800 - 52 - dockHeightPx) / 2);
  });
});
