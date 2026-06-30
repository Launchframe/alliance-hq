import { describe, expect, it } from "vitest";

import {
  followMeObserverRootMargin,
  followMeViewportCenterY,
  pickRowClosestToViewportCenter,
} from "@/lib/video/follow-me-row";

describe("pickRowClosestToViewportCenter", () => {
  it("returns the row with smallest distance to center", () => {
    expect(
      pickRowClosestToViewportCenter([
        { rowId: "a", distanceFromCenterPx: 120 },
        { rowId: "b", distanceFromCenterPx: 40 },
        { rowId: "c", distanceFromCenterPx: 90 },
      ]),
    ).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(pickRowClosestToViewportCenter([])).toBeNull();
  });

  it("picks the same row regardless of which side of center is closer (symmetric)", () => {
    // A row 30px above center and a row 30px below center are equidistant; the
    // first listed wins ties, but a row marginally closer always wins on either
    // side. This guards against re-introducing a scroll-direction bias that made
    // scroll-up land one row early.
    const above = { rowId: "above", distanceFromCenterPx: 30 };
    const below = { rowId: "below", distanceFromCenterPx: 29 };
    expect(pickRowClosestToViewportCenter([above, below])).toBe("below");
    expect(pickRowClosestToViewportCenter([below, above])).toBe("below");
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
});
