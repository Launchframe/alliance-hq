import { describe, expect, it } from "vitest";

import {
  functionTraceBudgets,
  videoOcrTracedRoutes,
} from "./video-ocr-file-tracing.mjs";

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
