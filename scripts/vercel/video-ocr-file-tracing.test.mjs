import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  functionTraceBudgets,
  ocrControlPlaneRoutes,
  sharpNativeFileTracing,
  tesseractFileTracing,
  videoOcrFileTracingIncludes,
  videoOcrFileTracingExcludes,
  videoOcrTracedRoutes,
} from "./video-ocr-file-tracing.mjs";

const picomatch = createRequire(import.meta.url)("next/dist/compiled/picomatch");
const includesFor = (route) => new Set(Object.entries(videoOcrFileTracingIncludes).flatMap(([pattern, includes]) => picomatch(pattern, { dot: true, contains: true })(route) ? includes : []));

describe("video OCR tracing — Phase 2a queue slim", () => {
  it("does not force OCR natives onto the queue cron route", () => {
    expect(videoOcrTracedRoutes["/api/internal/video-process/queue"]).toBeUndefined();
    expect(videoOcrTracedRoutes["/api/internal/video-process/[jobId]"]).toBeDefined();
  });

  it("keeps a lower budget and forbids ffmpeg/tesseract on the queue cron", () => {
    const queue = functionTraceBudgets.find(
      (row) => row.route === "/api/internal/video-process/queue",
    );
    expect(queue).toBeDefined();
    expect(queue.maxUncompressedBytes).toBeLessThanOrEqual(120 * 1024 * 1024);
    expect(queue.requireLibvips).toBe(true);
    expect(queue.forbidPathSubstrings).toEqual(
      expect.arrayContaining([
        "ffmpeg-static",
        "tesseract.js-core",
        "tesseract.js/src",
      ]),
    );
  });

  it("requires tesseract worker-script + constants on Discord and THP OCR routes", () => {
    for (const route of [
      "/api/webhooks/discord/interactions",
      "/api/thp/me/submit",
    ]) {
      const budget = functionTraceBudgets.find((row) => row.route === route);
      expect(budget, route).toBeDefined();
      if (!budget) {
        continue;
      }
      expect(budget.requireWorkerScript, route).toBe(true);
    }
  });
});

describe("literal Next tracing routes", () => {
  it("never bundles local private assets or worker runtimes", () => {
    expect(videoOcrFileTracingExcludes).toEqual(expect.arrayContaining(["./.data/**/*", "./workers/ocr/**/*"]));
    for (const budget of functionTraceBudgets) expect(budget.forbidPathSubstrings).toEqual(expect.arrayContaining([".data/"]));
  });

  it("keeps the control plane independent of compute runtimes", () => {
    expect(ocrControlPlaneRoutes).toHaveLength(4);
    for (const route of ocrControlPlaneRoutes) {
      const budget = functionTraceBudgets.find((entry) => entry.route === route);
      expect(budget.requireLibvips).toBe(true);
      expect(budget.maxUncompressedBytes).toBeLessThanOrEqual(120 * 1024 ** 2);
      expect(budget.forbidPathSubstrings).toEqual(expect.arrayContaining(["ffmpeg-static", "tesseract.js-core", "tesseract.js/src", "workers/ocr/"]));
      expect(includesFor(route).size).toBe(0);
    }
  });

  it("keeps every declared route's required native assets", () => {
    for (const [route, assets] of Object.entries(videoOcrTracedRoutes)) {
      expect([...includesFor(route)]).toEqual(expect.arrayContaining(assets));
    }
  });

  it("does not mistake the o in ocr-media for the [jobId] character class", () => {
    const media = includesFor("/api/internal/video-process/ocr-media/[taskId]");
    expect([...media]).toEqual(expect.arrayContaining(sharpNativeFileTracing));
    for (const asset of tesseractFileTracing) expect(media.has(asset)).toBe(false);
    expect(includesFor("/api/internal/video-process/queue").size).toBe(0);
  });
});
