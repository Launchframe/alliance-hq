import { describe, expect, it } from "vitest";

import {
  POINTER_SCROLL_DRAG_THRESHOLD_PX,
  computePointerScrollTop,
} from "@/lib/video/pointer-scroll-pan-logic";

describe("computePointerScrollTop", () => {
  it("ignores movement below the drag threshold until dragging starts", () => {
    expect(
      computePointerScrollTop(
        100,
        50,
        50 + POINTER_SCROLL_DRAG_THRESHOLD_PX - 1,
        false,
      ),
    ).toBeNull();
  });

  it("starts panning once movement exceeds the threshold", () => {
    expect(
      computePointerScrollTop(
        100,
        50,
        50 + POINTER_SCROLL_DRAG_THRESHOLD_PX,
        false,
      ),
    ).toEqual({ scrollTop: 94, dragging: true });
  });

  it("continues panning while dragging is active", () => {
    expect(computePointerScrollTop(100, 50, 80, true)).toEqual({
      scrollTop: 70,
      dragging: true,
    });
  });
});
