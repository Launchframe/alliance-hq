import { describe, expect, it } from "vitest";

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";

import { pickScoreUploadSpinDate } from "./score-upload-spin-prompt.shared";

const vsRule = { kind: "vs_top_n", n: 10 } as unknown as ConductorRule;
const randomRule = { kind: "random_eligible" } as unknown as ConductorRule;

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

  it("skips rules that do not use VS scores", () => {
    expect(
      pickScoreUploadSpinDate({
        ...base,
        days: [
          { date: "2026-10-15", conductorRule: randomRule },
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
