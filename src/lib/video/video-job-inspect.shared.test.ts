import { describe, expect, it } from "vitest";

import {
  buildVideoJobInspectHints,
  resolveVideoJobOcrEngineHint,
  summarizeOcrRaw,
} from "@/lib/video/video-job-inspect.shared";

describe("summarizeOcrRaw", () => {
  it("unwraps nested Ashed output shape", () => {
    const summary = summarizeOcrRaw({
      output: { members: [{ name: "A" }, { name: "B" }] },
    }) as Record<string, unknown>;
    expect(summary.membersLength).toBe(2);
    expect(summary.membersIsArray).toBe(true);
  });
});

describe("resolveVideoJobOcrEngineHint", () => {
  it("returns native when alliance HQ OCR only is enabled", () => {
    expect(resolveVideoJobOcrEngineHint(1)).toBe("native (video_hq_ocr_only)");
  });

  it("returns ashed by default", () => {
    expect(resolveVideoJobOcrEngineHint(0)).toBe("ashed (default prod)");
  });
});

describe("buildVideoJobInspectHints", () => {
  const base = {
    status: "review",
    errorMessage: null,
    frameCount: 8,
    totalOcrEntries: 40,
    timingsSummary: {
      frameCount: 8,
      rowCount: 10,
      matchedCount: 8,
      totalRawOcrRows: 40,
      totalMs: 1000,
      phases: {},
    },
    ocrEngineHint: "ashed (default prod)",
    parsedRowsInDb: 10,
    approvedAt: "2026-07-05T05:36:06.544Z",
    updatedAt: "2026-07-05T05:37:00.000Z",
    nowMs: Date.parse("2026-07-05T05:38:00.000Z"),
  };

  it("flags stuck parsing with no OCR results", () => {
    const hints = buildVideoJobInspectHints({
      ...base,
      status: "parsing",
      totalOcrEntries: 0,
      timingsSummary: null,
      parsedRowsInDb: 0,
    });
    expect(hints.map((h) => h.code)).toContain("stuck_parsing_no_ocr");
  });

  it("adds native OCR note when HQ OCR only is active", () => {
    const hints = buildVideoJobInspectHints({
      ...base,
      status: "parsing",
      totalOcrEntries: 0,
      timingsSummary: null,
      ocrEngineHint: "native (video_hq_ocr_only)",
      parsedRowsInDb: 0,
    });
    expect(hints.map((h) => h.code)).toEqual([
      "stuck_parsing_no_ocr",
      "stuck_parsing_native_ocr",
    ]);
  });

  it("flags stale queued jobs", () => {
    const hints = buildVideoJobInspectHints({
      ...base,
      status: "queued",
      approvedAt: "2026-07-05T05:00:00.000Z",
      updatedAt: "2026-07-05T05:00:00.000Z",
      nowMs: Date.parse("2026-07-05T05:10:00.000Z"),
    });
    expect(hints.map((h) => h.code)).toContain("queued_stale");
  });
});
