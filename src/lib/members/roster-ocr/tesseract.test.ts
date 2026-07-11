import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTesseractWorkerOptions } from "@/lib/members/roster-ocr/tesseract";
import { tesseractFileTracing } from "../../../../scripts/vercel/video-ocr-file-tracing.mjs";

const recognizeState = { active: 0, maxConcurrent: 0 };

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async () => {
      recognizeState.active += 1;
      recognizeState.maxConcurrent = Math.max(
        recognizeState.maxConcurrent,
        recognizeState.active,
      );
      await new Promise((resolve) => setTimeout(resolve, 15));
      recognizeState.active -= 1;
      return {
        data: {
          blocks: [
            {
              paragraphs: [
                {
                  lines: [{ text: "R5 Player", confidence: 90 }],
                },
              ],
            },
          ],
        },
      };
    }),
    terminate: vi.fn(async () => undefined),
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildTesseractWorkerOptions", () => {
  it("omits langPath by default so tesseract.js uses CDN traineddata", () => {
    vi.stubEnv("TESSERACT_LANG_PATH", "");
    const options = buildTesseractWorkerOptions();
    expect(options.langPath).toBeUndefined();
    // Must be a real filesystem string — Turbopack module ids break Worker().
    expect(typeof options.workerPath).toBe("string");
    expect(options.workerPath).toMatch(/[/\\]worker-script[/\\]node[/\\]index\.js$/);
    expect(existsSync(options.workerPath)).toBe(true);
  });

  it("resolves workerPath via package.json so bundlers cannot rewrite it to a module id", () => {
    const options = buildTesseractWorkerOptions();
    expect(Number.isFinite(Number(options.workerPath))).toBe(false);
    expect(options.workerPath.includes("node_modules")).toBe(true);
  });

  it("keeps worker-script relative requires on disk (NFT must ship constants/)", () => {
    const options = buildTesseractWorkerOptions();
    const workerDir = path.dirname(options.workerPath);
    // dump.js → ../../constants/imageType; getCore.js → ../../constants/OEM
    expect(
      existsSync(path.join(workerDir, "../../constants/imageType.js")),
    ).toBe(true);
    expect(existsSync(path.join(workerDir, "../../constants/OEM.js"))).toBe(true);
  });

  it("passes trimmed TESSERACT_LANG_PATH when set", () => {
    vi.stubEnv(
      "TESSERACT_LANG_PATH",
      "  https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int  ",
    );
    expect(buildTesseractWorkerOptions().langPath).toBe(
      "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int",
    );
  });
});

describe("tesseractFileTracing", () => {
  it("includes constants required by the worker thread (not only worker-script/)", () => {
    expect(tesseractFileTracing).toEqual(
      expect.arrayContaining([
        "./node_modules/tesseract.js/src/constants/**/*",
        "./node_modules/tesseract.js/src/worker-script/**/*",
      ]),
    );
  });
});

describe("runTesseract", () => {
  beforeEach(() => {
    recognizeState.active = 0;
    recognizeState.maxConcurrent = 0;
  });

  afterEach(async () => {
    const { terminateTesseractWorker } = await import("@/lib/members/roster-ocr/tesseract");
    await terminateTesseractWorker();
    vi.resetModules();
  });

  it("serializes concurrent recognize() calls on the shared worker", async () => {
    const { runTesseract } = await import("@/lib/members/roster-ocr/tesseract");
    const imageBuffer = Buffer.from("fake-png");

    await Promise.all([
      runTesseract(imageBuffer),
      runTesseract(imageBuffer),
      runTesseract(imageBuffer),
    ]);

    expect(recognizeState.maxConcurrent).toBe(1);
  });
});
