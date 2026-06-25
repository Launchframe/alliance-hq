import { describe, expect, it } from "vitest";

import {
  availablePlacements,
  clampPlacement,
  deviceClassForWidth,
  parsePreviewPrefs,
  serializePreviewPrefs,
  DEFAULT_PLACEMENT,
} from "@/lib/video/preview-layout";

describe("deviceClassForWidth", () => {
  it("classifies phones, tablets, and desktops at Tailwind breakpoints", () => {
    expect(deviceClassForWidth(375)).toBe("mobile");
    expect(deviceClassForWidth(767)).toBe("mobile");
    expect(deviceClassForWidth(768)).toBe("tablet");
    expect(deviceClassForWidth(1023)).toBe("tablet");
    expect(deviceClassForWidth(1024)).toBe("desktop");
    expect(deviceClassForWidth(1920)).toBe("desktop");
  });
});

describe("availablePlacements", () => {
  it("offers only top/bottom on mobile (no room for a side column)", () => {
    expect(availablePlacements("mobile")).toEqual(["top", "bottom"]);
  });

  it("offers all three on tablet", () => {
    expect(availablePlacements("tablet")).toEqual(["side", "top", "bottom"]);
  });

  it("offers side on desktop", () => {
    expect(availablePlacements("desktop")).toEqual(["side"]);
  });
});

describe("clampPlacement", () => {
  it("keeps a valid placement", () => {
    expect(clampPlacement("tablet", "top")).toBe("top");
  });

  it("falls back to the device default for an unsupported placement", () => {
    expect(clampPlacement("mobile", "side")).toBe(DEFAULT_PLACEMENT.mobile);
    expect(clampPlacement("desktop", "bottom")).toBe(DEFAULT_PLACEMENT.desktop);
  });

  it("falls back to default for null/undefined", () => {
    expect(clampPlacement("tablet", null)).toBe(DEFAULT_PLACEMENT.tablet);
    expect(clampPlacement("tablet", undefined)).toBe(DEFAULT_PLACEMENT.tablet);
  });
});

describe("parsePreviewPrefs", () => {
  it("returns defaults for empty/invalid input", () => {
    expect(parsePreviewPrefs(null)).toEqual({
      open: false,
      placement: { ...DEFAULT_PLACEMENT },
    });
    expect(parsePreviewPrefs("not json")).toEqual({
      open: false,
      placement: { ...DEFAULT_PLACEMENT },
    });
  });

  it("round-trips and clamps invalid per-device placements", () => {
    const stored = serializePreviewPrefs({
      open: true,
      placement: { desktop: "side", tablet: "bottom", mobile: "top" },
    });
    expect(parsePreviewPrefs(stored)).toEqual({
      open: true,
      placement: { desktop: "side", tablet: "bottom", mobile: "top" },
    });
  });

  it("repairs a mobile placement of side to the mobile default", () => {
    const stored = JSON.stringify({
      open: true,
      placement: { mobile: "side" },
    });
    expect(parsePreviewPrefs(stored).placement.mobile).toBe(
      DEFAULT_PLACEMENT.mobile,
    );
  });
});
