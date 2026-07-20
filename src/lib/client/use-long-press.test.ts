import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createLongPressController } from "@/lib/client/long-press.shared";

describe("createLongPressController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires after holdMs when the pointer stays still", () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress, holdMs: 500 });

    controller.onPointerDown({ clientX: 10, clientY: 10 });
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(controller.didFireLongPress()).toBe(true);
  });

  it("cancels when the pointer moves beyond tolerance", () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({
      onLongPress,
      holdMs: 500,
      moveTolerancePx: 10,
    });

    controller.onPointerDown({ clientX: 10, clientY: 10 });
    controller.onPointerMove({ clientX: 30, clientY: 10 });
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(controller.didFireLongPress()).toBe(false);
  });

  it("cancels on pointer up before hold completes", () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress, holdMs: 500 });

    controller.onPointerDown({ clientX: 10, clientY: 10 });
    controller.onPointerUp();
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
