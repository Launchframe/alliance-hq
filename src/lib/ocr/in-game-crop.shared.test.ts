import { describe, expect, it } from "vitest";

import {
  inGameScreenshotLayoutFromTopRow,
  inGameTopStripBox,
  isPortraitPhoneFrame,
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

  it("needs both a resource decimal and a suffix — partial HUD reads stay menu", () => {
    expect(topRowHasResourceHud("173.5")).toBe(false);
    expect(topRowHasResourceHud("173M")).toBe(false);
    expect(topRowHasResourceHud("M")).toBe(false);
    expect(inGameScreenshotLayoutFromTopRow("173.5")).toBe("menu");
    expect(
      inGameScreenshotLayoutFromTopRow("173.5", { width: 1024, height: 704 }),
    ).toBe("menu");
    expect(
      inGameScreenshotLayoutFromTopRow("", { width: 1024, height: 704 }),
    ).toBe("menu");
  });

  it("keeps a portrait phone frame on the phone layout when the HUD read is incomplete", () => {
    expect(isPortraitPhoneFrame(399, 1024)).toBe(true);
    expect(isPortraitPhoneFrame(473, 1024)).toBe(true);
    expect(isPortraitPhoneFrame(1000, 1600)).toBe(true);
    expect(isPortraitPhoneFrame(1000, 1599)).toBe(false);
    expect(isPortraitPhoneFrame(0, 1024)).toBe(false);
    expect(isPortraitPhoneFrame(1024, 704)).toBe(false);
    expect(
      inGameScreenshotLayoutFromTopRow("", { width: 399, height: 1024 }),
    ).toBe("phone");
    expect(
      inGameScreenshotLayoutFromTopRow("173.5", { width: 473, height: 1024 }),
    ).toBe("phone");
    expect(
      inGameScreenshotLayoutFromTopRow("173M", { width: 399, height: 1024 }),
    ).toBe("phone");
  });
});
