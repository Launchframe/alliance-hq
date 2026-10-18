import { describe, expect, it } from "vitest";

import {
  inGameScreenshotLayoutFromTopRow,
  inGameTopStripBox,
  topRowHasResourceHud,
} from "@/lib/ocr/in-game-crop.shared";

describe("in-game crop detection", () => {
  it("takes the top 12% of a phone screenshot, at least 36px", () => {
    expect(inGameTopStripBox(399, 1024)).toEqual({
      left: 0,
      top: 0,
      width: 399,
      height: 123,
    });
    expect(inGameTopStripBox(1024, 200).height).toBe(36);
    expect(inGameTopStripBox(1024, 20).height).toBe(20);
  });

  it("treats a resource-bar reading as a full phone screenshot", () => {
    expect(topRowHasResourceHud("226.0 M")).toBe(true);
    expect(topRowHasResourceHud("3,46 3,86 1,66 M")).toBe(true);
    expect(topRowHasResourceHud("166.1m 173.5M 16.5M 6.32K")).toBe(true);
    expect(inGameScreenshotLayoutFromTopRow("173.5M")).toBe("phone");
  });

  it("treats a menu title with no resource amounts as a crop", () => {
    expect(topRowHasResourceHud("")).toBe(false);
    expect(topRowHasResourceHud("74")).toBe(false);
    expect(topRowHasResourceHud("163154877")).toBe(false);
    expect(topRowHasResourceHud("163,154,877")).toBe(false);
    expect(inGameScreenshotLayoutFromTopRow("")).toBe("menu");
  });
});
