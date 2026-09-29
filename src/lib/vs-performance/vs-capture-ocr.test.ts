import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseVsCaptureImage } from "./vs-capture-ocr.server";

const daily = "src/lib/vs-performance/fixtures/vs-daily-totals-redacted.png";
const weekly =
  "src/lib/vs-performance/fixtures/vs-weekly-overview-redacted.png";

describe("parseVsCaptureImage redacted game fixtures", () => {
  it("reads the ongoing daily duel: day 2, LFgo/TriV, score 0", async () => {
    const candidate = await parseVsCaptureImage(
      readFileSync(daily),
      "daily_totals",
    );
    expect(candidate.kind).toBe("daily_totals");
    expect(candidate.day).toBe(2);
    expect(candidate.left.tag).toBe("LFgo");
    expect(candidate.right.tag).toBe("TriV");
    expect(candidate.leftScore).toBe("0");
    expect(candidate.rightScore).toBe("0");
    expect(candidate.ongoing).toBe(true);
    expect(
      candidate.dayResults.every((day) => day.winner === "unknown"),
    ).toBe(true);
  }, 300_000);

  it("reads the weekly overview: servers 1203/1236, left points 0, partial identity", async () => {
    const candidate = await parseVsCaptureImage(
      readFileSync(weekly),
      "weekly_overview",
    );
    expect(candidate.kind).toBe("weekly_overview");
    expect(candidate.left.server).toBe(1203);
    expect(candidate.right.server).toBe(1236);
    expect(candidate.leftPoints).toBe(0);
    expect(
      candidate.dayResults.every((day) => day.winner === "unknown"),
    ).toBe(true);
    expect(candidate.partial).toBe(true);
  }, 300_000);
});
