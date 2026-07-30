import { describe, expect, it } from "vitest";

import {
  busterDayWeekDates,
  busterDayWeekMondayForDate,
  isBusterDaySnapshotComplete,
  normalizeOptionalBusterDayJobId,
  resolveBusterDayPartialAttach,
  resolveBusterDayWizardPhase,
} from "./buster-day.shared";

describe("busterDayWeekDates", () => {
  it("maps Monday to Fri/Sat/Sun of the same VS week", () => {
    // 2026-07-13 is Monday ST
    expect(busterDayWeekDates("2026-07-13")).toEqual({
      vsWeekMonday: "2026-07-13",
      friday: "2026-07-17",
      saturday: "2026-07-18",
      sunday: "2026-07-19",
    });
  });
});

describe("busterDayWeekMondayForDate", () => {
  it("rolls Sunday back to the prior Monday", () => {
    expect(busterDayWeekMondayForDate("2026-07-19")).toBe("2026-07-13");
  });

  it("keeps Friday in the same week", () => {
    expect(busterDayWeekMondayForDate("2026-07-17")).toBe("2026-07-13");
  });
});

describe("resolveBusterDayWizardPhase", () => {
  it("returns pre_snapshot on Friday", () => {
    expect(resolveBusterDayWizardPhase("2026-07-17")).toBe("pre_snapshot");
  });

  it("returns in_progress on Saturday", () => {
    expect(resolveBusterDayWizardPhase("2026-07-18")).toBe("in_progress");
  });

  it("returns post_snapshot on Sunday", () => {
    expect(resolveBusterDayWizardPhase("2026-07-19")).toBe("post_snapshot");
  });

  it("returns idle Mon–Thu", () => {
    expect(resolveBusterDayWizardPhase("2026-07-13")).toBe("idle");
    expect(resolveBusterDayWizardPhase("2026-07-16")).toBe("idle");
  });
});

describe("isBusterDaySnapshotComplete", () => {
  it("requires both roster and kills job ids", () => {
    expect(
      isBusterDaySnapshotComplete({
        rosterJobId: "r1",
        killsJobId: "k1",
      }),
    ).toBe(true);
    expect(
      isBusterDaySnapshotComplete({
        rosterJobId: "r1",
        killsJobId: null,
      }),
    ).toBe(false);
    expect(
      isBusterDaySnapshotComplete({
        rosterJobId: "",
        killsJobId: "k1",
      }),
    ).toBe(false);
  });
});

describe("normalizeOptionalBusterDayJobId", () => {
  it("preserves undefined and null", () => {
    expect(normalizeOptionalBusterDayJobId(undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(normalizeOptionalBusterDayJobId(null)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("trims non-empty ids and rejects blanks", () => {
    expect(normalizeOptionalBusterDayJobId("  job-1  ")).toEqual({
      ok: true,
      value: "job-1",
    });
    expect(normalizeOptionalBusterDayJobId("")).toMatchObject({ ok: false });
    expect(normalizeOptionalBusterDayJobId("   ")).toMatchObject({
      ok: false,
    });
  });
});

describe("busterDayWeekMondayForDate normalization", () => {
  it("maps mid-week dates to the VS week Monday", () => {
    expect(busterDayWeekMondayForDate("2026-07-15")).toBe("2026-07-13");
    expect(busterDayWeekMondayForDate("2026-07-13")).toBe("2026-07-13");
  });
});

describe("resolveBusterDayPartialAttach", () => {
  const locked = {
    preRosterJobId: "pre-r",
    preKillsJobId: null,
    postRosterJobId: null,
    postKillsJobId: "post-k",
  };

  it("keeps the sibling job id when only roster is attached", () => {
    expect(
      resolveBusterDayPartialAttach({
        kind: "pre",
        locked,
        rosterJobId: "pre-r-new",
        killsJobId: undefined,
      }),
    ).toEqual({ nextRoster: "pre-r-new", nextKills: null });
  });

  it("keeps the sibling job id when only kills is attached", () => {
    expect(
      resolveBusterDayPartialAttach({
        kind: "pre",
        locked,
        rosterJobId: undefined,
        killsJobId: "pre-k-new",
      }),
    ).toEqual({ nextRoster: "pre-r", nextKills: "pre-k-new" });
  });

  it("does not read pre columns when attaching post snapshot jobs", () => {
    expect(
      resolveBusterDayPartialAttach({
        kind: "post",
        locked,
        rosterJobId: "post-r",
        killsJobId: undefined,
      }),
    ).toEqual({ nextRoster: "post-r", nextKills: "post-k" });
  });
});
