import { describe, expect, it } from "vitest";

import {
  availablePlacements,
  clampDockHeightPx,
  clampPlacement,
  clampPreviewSize,
  clampSideWidthPx,
  clampZoom,
  defaultDockHeightPx,
  defaultSideWidthPx,
  deviceClassForWidth,
  parsePreviewPrefs,
  serializePreviewPrefs,
  DEFAULT_PLACEMENT,
} from "@/lib/video/preview-layout";

const VIEWPORT = { width: 1280, height: 800 };

function expectedDefaultPrefs() {
  const size = {
    desktop: clampPreviewSize(null, VIEWPORT),
    tablet: clampPreviewSize(null, VIEWPORT),
    mobile: clampPreviewSize(null, VIEWPORT),
  };
  return {
    open: true,
    placement: { ...DEFAULT_PLACEMENT },
    zoom: "fit" as const,
    size,
  };
}

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

describe("clampZoom", () => {
  it("keeps known zoom values", () => {
    expect(clampZoom("fit")).toBe("fit");
    expect(clampZoom("width")).toBe("width");
  });

  it("defaults unknown/empty zoom to fit", () => {
    expect(clampZoom(null)).toBe("fit");
    expect(clampZoom(undefined)).toBe("fit");
    expect(clampZoom("huge" as never)).toBe("fit");
  });
});

describe("preview pane size", () => {
  it("defaults side width to min(45vw, 26rem)", () => {
    expect(defaultSideWidthPx(1920)).toBe(416);
    expect(defaultSideWidthPx(800)).toBe(360);
  });

  it("defaults dock height to 42% of viewport", () => {
    expect(defaultDockHeightPx(1000)).toBe(420);
  });

  it("clamps side width between 256px and 70vw", () => {
    expect(clampSideWidthPx(100, 1000)).toBe(256);
    expect(clampSideWidthPx(900, 1000)).toBe(700);
    expect(clampSideWidthPx(400, 1000)).toBe(400);
  });

  it("clamps dock height between 20% and 80% of viewport", () => {
    expect(clampDockHeightPx(50, 1000)).toBe(200);
    expect(clampDockHeightPx(900, 1000)).toBe(800);
    expect(clampDockHeightPx(420, 1000)).toBe(420);
  });
});

describe("parsePreviewPrefs", () => {
  it("returns defaults for empty/invalid input", () => {
    expect(parsePreviewPrefs(null, VIEWPORT)).toEqual(expectedDefaultPrefs());
    expect(parsePreviewPrefs("not json", VIEWPORT)).toEqual(
      expectedDefaultPrefs(),
    );
  });

  it("round-trips and clamps invalid per-device placements", () => {
    const stored = serializePreviewPrefs({
      open: true,
      placement: { desktop: "side", tablet: "bottom", mobile: "top" },
      zoom: "width",
      size: {
        desktop: { sideWidthPx: 400, dockHeightPx: 400 },
        tablet: { sideWidthPx: 380, dockHeightPx: 350 },
        mobile: { sideWidthPx: 320, dockHeightPx: 300 },
      },
    });
    expect(parsePreviewPrefs(stored, VIEWPORT)).toEqual({
      open: true,
      placement: { desktop: "side", tablet: "bottom", mobile: "top" },
      zoom: "width",
      size: {
        desktop: { sideWidthPx: 400, dockHeightPx: 400 },
        tablet: { sideWidthPx: 380, dockHeightPx: 350 },
        mobile: { sideWidthPx: 320, dockHeightPx: 300 },
      },
    });
  });

  it("repairs a mobile placement of side to the mobile default", () => {
    const stored = JSON.stringify({
      open: true,
      placement: { mobile: "side" },
    });
    expect(parsePreviewPrefs(stored, VIEWPORT).placement.mobile).toBe(
      DEFAULT_PLACEMENT.mobile,
    );
  });

  it("defaults zoom to fit when missing or invalid in stored prefs", () => {
    expect(parsePreviewPrefs(JSON.stringify({ open: true }), VIEWPORT).zoom).toBe(
      "fit",
    );
    expect(parsePreviewPrefs(JSON.stringify({ zoom: "nope" }), VIEWPORT).zoom).toBe(
      "fit",
    );
  });

  it("fills in default size when stored prefs omit size", () => {
    const parsed = parsePreviewPrefs(
      JSON.stringify({ open: true, placement: DEFAULT_PLACEMENT, zoom: "fit" }),
      VIEWPORT,
    );
    expect(parsed.size.desktop.sideWidthPx).toBe(defaultSideWidthPx(1280));
    expect(parsed.size.mobile.dockHeightPx).toBe(defaultDockHeightPx(800));
  });
});
