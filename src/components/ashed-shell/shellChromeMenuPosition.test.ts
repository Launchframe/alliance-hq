import { describe, expect, it } from "vitest";

import {
  isShellChromeMobileViewport,
  shellChromeMenuRectFromTrigger,
} from "./shellChromeMenuPosition";

const trigger = {
  bottom: 56,
  right: 1200,
  left: 1120,
  top: 20,
  width: 80,
  height: 36,
  x: 1120,
  y: 20,
  toJSON: () => ({}),
} as DOMRect;

describe("shellChromeMenuPosition", () => {
  it("treats widths at/under the sm breakpoint as mobile", () => {
    expect(isShellChromeMobileViewport(639)).toBe(true);
    expect(isShellChromeMobileViewport(640)).toBe(false);
  });

  it("centers full-width on mobile via left and right insets", () => {
    const rect = shellChromeMenuRectFromTrigger(trigger, {
      viewportWidth: 390,
    });

    expect(rect).toEqual({
      top: 64,
      left: 16,
      right: 16,
    });
  });

  it("right-aligns to the trigger on desktop", () => {
    const rect = shellChromeMenuRectFromTrigger(trigger, {
      desktopMinWidth: 220,
      desktopWidth: 352,
      viewportWidth: 1280,
    });

    expect(rect).toEqual({
      top: 64,
      right: 80,
      minWidth: 220,
      width: 352,
    });
  });
});
