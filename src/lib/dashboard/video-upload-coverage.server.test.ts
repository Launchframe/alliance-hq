import { describe, expect, it } from "vitest";

import {
  isWeekendServerDay,
  resolveVsPerformanceLookbackHours,
} from "@/lib/dashboard/video-upload-coverage.server";

describe("video-upload-coverage.server", () => {
  it("uses 48h lookback on Monday server days", () => {
    expect(resolveVsPerformanceLookbackHours("2026-07-06")).toBe(48);
  });

  it("uses 24h lookback on non-Monday server days", () => {
    expect(resolveVsPerformanceLookbackHours("2026-07-07")).toBe(24);
  });

  it("detects weekend server days", () => {
    expect(isWeekendServerDay("2026-07-05")).toBe(true);
    expect(isWeekendServerDay("2026-07-06")).toBe(false);
  });
});
