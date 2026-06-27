import { describe, expect, it } from "vitest";

import {
  buildRowOrderIndex,
  followMeObserverRootMargin,
  followMeViewportCenterY,
  pickNewlyEnteredRow,
  pickRowClosestToViewportCenter,
} from "@/lib/video/follow-me-row";

describe("buildRowOrderIndex", () => {
  it("maps row ids to table order", () => {
    const map = buildRowOrderIndex([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(map.get("a")).toBe(0);
    expect(map.get("b")).toBe(1);
    expect(map.get("c")).toBe(2);
  });
});

describe("pickNewlyEnteredRow", () => {
  const order = buildRowOrderIndex([
    { id: "r0" },
    { id: "r1" },
    { id: "r2" },
    { id: "r3" },
  ]);

  it("returns the sole id when only one row entered", () => {
    expect(pickNewlyEnteredRow(["r2"], order, "down")).toBe("r2");
  });

  it("picks the highest index when scrolling down", () => {
    expect(pickNewlyEnteredRow(["r1", "r3"], order, "down")).toBe("r3");
  });

  it("picks the lowest index when scrolling up", () => {
    expect(pickNewlyEnteredRow(["r1", "r3"], order, "up")).toBe("r1");
  });

  it("falls back to lowest index when scroll direction is unknown", () => {
    expect(pickNewlyEnteredRow(["r1", "r3"], order, "unknown")).toBe("r1");
  });
});

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
