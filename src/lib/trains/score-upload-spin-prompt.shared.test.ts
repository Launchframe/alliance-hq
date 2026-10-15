import { describe, expect, it } from "vitest";

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";

import { pickScoreUploadSpinDate } from "./score-upload-spin-prompt.shared";

const vsRule: ConductorRule = { kind: "vs_top_n", topN: 10 };
const pifRule: ConductorRule = {
  kind: "price_is_freight",
  board: "weekday",
};
const r4Wheel: ConductorRule = {
  kind: "rank_pool",
  pool: "r4_plus",
  draw: "wheel",
};

describe("pickScoreUploadSpinDate", () => {
  const base = {
    vsRecordedDate: "2026-10-14",
    today: "2026-10-15",
    leadDays: 0,
    assignedDates: new Set<string>(),
  };

  it("returns the next train day that reads these VS scores", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        days: [
          { date: "2026-10-15", conductorRule: vsRule },
          { date: "2026-10-16", conductorRule: vsRule },
        ],
      }),
    ).toBe("2026-10-15");
  });

  it("honors conductor lead time", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        leadDays: 1,
        days: [
          { date: "2026-10-15", conductorRule: vsRule },
          { date: "2026-10-16", conductorRule: vsRule },
        ],
      }),
    ).toBe("2026-10-16");
  });

  it("skips days that already have a conductor", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        assignedDates: new Set(["2026-10-15"]),
        days: [{ date: "2026-10-15", conductorRule: vsRule }],
      }),
    ).toBeNull();
  });

  it("includes Price Is Freight days that read the uploaded scores", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        days: [{ date: "2026-10-15", conductorRule: pifRule }],
      }),
    ).toBe("2026-10-15");
  });

  it("skips non-VS train rules even when the score date matches", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        days: [
          { date: "2026-10-15", conductorRule: r4Wheel },
          { date: "2026-10-15", conductorRule: null },
        ],
      }),
    ).toBeNull();
  });

  it("never points at a train day already in the past", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        today: "2026-10-16",
        days: [{ date: "2026-10-15", conductorRule: vsRule }],
      }),
    ).toBeNull();
  });
});
