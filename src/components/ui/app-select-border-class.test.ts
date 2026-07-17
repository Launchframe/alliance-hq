import { describe, expect, it } from "vitest";

import {
  hasBorderColorClass,
  withDefaultBorderColor,
} from "./app-select-border-class";

describe("hasBorderColorClass", () => {
  it("detects semantic and arbitrary border colors", () => {
    expect(hasBorderColorClass("px-2 border-hq-green")).toBe(true);
    expect(hasBorderColorClass("border-hq-green border-dashed")).toBe(true);
    expect(hasBorderColorClass("border-hq-danger")).toBe(true);
    expect(hasBorderColorClass("border-[#d29922]")).toBe(true);
  });

  it("ignores width, side, and style border utilities", () => {
    expect(hasBorderColorClass("px-2 py-1.5")).toBe(false);
    expect(hasBorderColorClass("border border-2")).toBe(false);
    expect(hasBorderColorClass("border-t border-solid")).toBe(false);
    expect(hasBorderColorClass("font-mono")).toBe(false);
  });
});

describe("withDefaultBorderColor", () => {
  it("keeps an existing border color", () => {
    expect(withDefaultBorderColor("px-2 border-hq-green")).toBe(
      "px-2 border-hq-green",
    );
  });

  it("adds the default border color when missing", () => {
    expect(withDefaultBorderColor("px-2 py-1.5")).toBe(
      "px-2 py-1.5 border-hq-border",
    );
  });
});
