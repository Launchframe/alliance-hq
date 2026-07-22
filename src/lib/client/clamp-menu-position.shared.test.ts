import { describe, expect, it } from "vitest";

import { clampMenuPosition } from "@/lib/client/clamp-menu-position.shared";

describe("clampMenuPosition", () => {
  const viewport = { width: 400, height: 600 };

  it("keeps position when the menu fits", () => {
    expect(clampMenuPosition(20, 30, 120, 200, viewport)).toEqual({
      left: 20,
      top: 30,
    });
  });

  it("shifts left when the menu overflows the right edge", () => {
    expect(clampMenuPosition(350, 30, 120, 200, viewport)).toEqual({
      left: 272,
      top: 30,
    });
  });

  it("shifts up when the menu overflows the bottom edge", () => {
    expect(clampMenuPosition(20, 500, 120, 200, viewport)).toEqual({
      left: 20,
      top: 392,
    });
  });

  it("clamps to padding when coordinates are negative", () => {
    expect(clampMenuPosition(-40, -20, 120, 200, viewport)).toEqual({
      left: 8,
      top: 8,
    });
  });
});
