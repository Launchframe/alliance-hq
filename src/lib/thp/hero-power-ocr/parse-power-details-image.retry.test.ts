import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  readInGameScreenshotLayout: vi.fn(),
  runTesseract: vi.fn(),
  labelLayouts: [] as string[],
  ocrLayouts: [] as string[],
  activeLayout: "menu",
  headerLayouts: new Set<string>(),
}));

function preprocess(...args: unknown[]) {
  const layout = [...args]
    .reverse()
    .find((arg) => arg === "phone" || arg === "menu");
  if (layout === "phone" || layout === "menu") harness.activeLayout = layout;
  return Promise.resolve({
    buffer: Buffer.from("png"),
    width: 40,
    height: 200,
  });
}

vi.mock("@/lib/ocr/in-game-crop", () => ({
  readInGameScreenshotLayout: harness.readInGameScreenshotLayout,
}));

vi.mock("@/lib/members/roster-ocr/tesseract", () => ({
  runTesseract: harness.runTesseract,
}));

vi.mock("@/lib/thp/hero-power-ocr/preprocess-power-details", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/thp/hero-power-ocr/preprocess-power-details")
  >("@/lib/thp/hero-power-ocr/preprocess-power-details");
  return {
    ...actual,
    preprocessPowerDetailsLabelBand: vi.fn((...args: unknown[]) => {
      const layout = args[2];
      if (layout === "phone" || layout === "menu") {
        harness.labelLayouts.push(layout);
      }
      return preprocess(...args);
    }),
    preprocessPowerDetailsValueBand: vi.fn(preprocess),
    preprocessPowerDetailsValueBandInverted: vi.fn(preprocess),
    preprocessPowerDetailsHeaderValue: vi.fn(preprocess),
    preprocessPowerDetailsComponentValueRow: vi.fn(preprocess),
    cropPowerDetailsValueRow: vi.fn(preprocess),
  };
});

import { parsePowerDetailsImage } from "@/lib/thp/hero-power-ocr/parse-power-details-image";

const image = Buffer.from("screenshot");
const headerLine = {
  text: "185438779",
  confidence: 90,
  bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
};

beforeEach(() => {
  harness.labelLayouts.length = 0;
  harness.ocrLayouts.length = 0;
  harness.activeLayout = "menu";
  harness.headerLayouts = new Set(["phone"]);
  harness.readInGameScreenshotLayout.mockReset();
  harness.readInGameScreenshotLayout.mockResolvedValue("menu");
  harness.runTesseract.mockReset();
  harness.runTesseract.mockImplementation(async () => {
    harness.ocrLayouts.push(harness.activeLayout);
    return harness.headerLayouts.has(harness.activeLayout) ? [headerLine] : [];
  });
});

describe("parsePowerDetailsImage layout retry", () => {
  it("returns the phone parse when the menu crop finds no header", async () => {
    const result = await parsePowerDetailsImage(image);

    expect(result.heroPowerTotal).toBe(185_438_779);
    expect(result.diagnostics.layout).toBe("phone");
    expect(harness.readInGameScreenshotLayout).toHaveBeenCalledTimes(1);
    expect(harness.labelLayouts).toEqual(["menu", "phone"]);
    expect(harness.ocrLayouts).toEqual([
      "menu",
      "menu",
      "menu",
      "menu",
      "phone",
      "phone",
      "phone",
      "phone",
    ]);
  });

  it("does not retry when the menu crop already has a header", async () => {
    harness.headerLayouts = new Set(["menu"]);

    const result = await parsePowerDetailsImage(image);

    expect(result.heroPowerTotal).toBe(185_438_779);
    expect(result.diagnostics.layout).toBe("menu");
    expect(harness.labelLayouts).toEqual(["menu"]);
    expect(harness.ocrLayouts).toEqual(["menu", "menu", "menu", "menu"]);
  });

  it("does not retry a caller-selected menu layout", async () => {
    harness.headerLayouts = new Set();

    const result = await parsePowerDetailsImage(image, "menu");

    expect(result.heroPowerTotal).toBeNull();
    expect(result.diagnostics.layout).toBe("menu");
    expect(harness.readInGameScreenshotLayout).not.toHaveBeenCalled();
    expect(harness.labelLayouts).toEqual(["menu"]);
  });

  it("stops after one phone retry when that crop also misses the header", async () => {
    harness.headerLayouts = new Set();

    const result = await parsePowerDetailsImage(image);

    expect(result.heroPowerTotal).toBeNull();
    expect(result.diagnostics.layout).toBe("phone");
    expect(harness.labelLayouts).toEqual(["menu", "phone"]);
    expect(harness.ocrLayouts.filter((layout) => layout === "phone")).toHaveLength(
      4,
    );
  });

  it("does not retry when detection already chose the phone layout", async () => {
    harness.readInGameScreenshotLayout.mockResolvedValue("phone");

    const result = await parsePowerDetailsImage(image);

    expect(result.heroPowerTotal).toBe(185_438_779);
    expect(result.diagnostics.layout).toBe("phone");
    expect(harness.readInGameScreenshotLayout).toHaveBeenCalledTimes(1);
    expect(harness.labelLayouts).toEqual(["phone"]);
  });
});
