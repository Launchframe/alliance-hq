import { beforeEach, describe, expect, it, vi } from "vitest";

const { metadata, runTesseract } = vi.hoisted(() => ({
  metadata: vi.fn(),
  runTesseract: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: () => {
    const image = {
      extract: () => image,
      resize: () => image,
      greyscale: () => image,
      negate: () => image,
      normalize: () => image,
      png: () => image,
      metadata,
      toBuffer: async () => Buffer.from("png"),
    };
    return image;
  },
}));

vi.mock("@/lib/members/roster-ocr/tesseract", () => ({ runTesseract }));

import { readInGameScreenshotLayout } from "@/lib/ocr/in-game-crop";

const image = Buffer.from("screenshot");

function line(text: string) {
  return {
    text,
    confidence: 0,
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
  };
}

beforeEach(() => {
  metadata.mockReset();
  runTesseract.mockReset();
  runTesseract.mockResolvedValue([]);
});

describe("readInGameScreenshotLayout", () => {
  it("keeps a portrait frame on the phone layout without reading the HUD", async () => {
    metadata.mockResolvedValue({ width: 399, height: 1024 });

    await expect(readInGameScreenshotLayout(image)).resolves.toBe("phone");
    expect(runTesseract).not.toHaveBeenCalled();
  });

  it("treats the 1.6 ratio as the portrait boundary", async () => {
    metadata.mockResolvedValue({ width: 1000, height: 1600 });
    await expect(readInGameScreenshotLayout(image)).resolves.toBe("phone");

    metadata.mockResolvedValue({ width: 1000, height: 1599 });
    runTesseract.mockResolvedValue([line("173.5")]);
    await expect(readInGameScreenshotLayout(image)).resolves.toBe("menu");
    expect(runTesseract).toHaveBeenCalledTimes(1);
  });

  it("uses the resource-bar read on a wide frame", async () => {
    metadata.mockResolvedValue({ width: 1024, height: 704 });
    runTesseract.mockResolvedValue([line("173.5M"), line("16.5M")]);

    await expect(readInGameScreenshotLayout(image)).resolves.toBe("phone");
    expect(runTesseract).toHaveBeenCalledTimes(1);
  });

  it("keeps a wide frame with a partial HUD read on the menu layout", async () => {
    metadata.mockResolvedValue({ width: 1024, height: 704 });
    runTesseract.mockResolvedValue([line("173.5")]);

    await expect(readInGameScreenshotLayout(image)).resolves.toBe("menu");
  });

  it("does not treat missing dimensions as a portrait frame", async () => {
    metadata.mockResolvedValue({});
    runTesseract.mockResolvedValue([line("")]);

    await expect(readInGameScreenshotLayout(image)).resolves.toBe("menu");
    expect(runTesseract).toHaveBeenCalledTimes(1);
  });

  it("keeps the phone layout when image metadata or the HUD read fails", async () => {
    metadata.mockRejectedValue(new Error("not an image"));
    await expect(readInGameScreenshotLayout(image)).resolves.toBe("phone");

    metadata.mockResolvedValue({ width: 1024, height: 704 });
    runTesseract.mockRejectedValue(new Error("ocr failed"));
    await expect(readInGameScreenshotLayout(image)).resolves.toBe("phone");
  });
});
