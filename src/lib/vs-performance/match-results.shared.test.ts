import { describe, expect, it } from "vitest";

import {
  assertVsResultDate,
  calculateVsWeekPoints,
  formatVsTotal,
  normalizeVsResult,
  parseLocalizedVsTotal,
  type VsDayResult,
} from "./match-results.shared";

const WEEK = "2026-09-21";
const dates = [
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
];

const result = (
  recordedDate: string,
  outcome: "pending" | "won" | "lost",
  finality: "unconfirmed" | "final" = "final",
): VsDayResult => ({ recordedDate, outcome, finality, totals: null });

describe("normalizeVsResult", () => {
  it("derives won from larger ourScore beyond JS-safe range", () => {
    expect(
      normalizeVsResult({
        totals: {
          ourScore: "9007199254740993",
          opponentScore: "9007199254740992",
        },
        reportedOutcome: null,
        finality: "final",
      }).outcome,
    ).toBe("won");
  });

  it("derives lost for the reversed totals", () => {
    expect(
      normalizeVsResult({
        totals: {
          ourScore: "9007199254740992",
          opponentScore: "9007199254740993",
        },
        reportedOutcome: null,
        finality: "final",
      }).outcome,
    ).toBe("lost");
  });

  it("equal totals with no reported outcome stay pending", () => {
    expect(
      normalizeVsResult({
        totals: { ourScore: "100", opponentScore: "100" },
        reportedOutcome: null,
        finality: "final",
      }).outcome,
    ).toBe("pending");
  });

  it("unconfirmed input is always pending", () => {
    expect(
      normalizeVsResult({
        totals: { ourScore: "2", opponentScore: "1" },
        reportedOutcome: null,
        finality: "unconfirmed",
      }).outcome,
    ).toBe("pending");
  });

  it("explicit outcome contradicting totals throws resultMismatch", () => {
    expect(() =>
      normalizeVsResult({
        totals: { ourScore: "1", opponentScore: "2" },
        reportedOutcome: "won",
        finality: "final",
      }),
    ).toThrow("resultMismatch");
  });

  it("null totals with final won keeps won", () => {
    expect(
      normalizeVsResult({
        totals: null,
        reportedOutcome: "won",
        finality: "final",
      }).outcome,
    ).toBe("won");
  });

  it("rejects negative, decimal and >30-digit totals", () => {
    for (const bad of ["-1", "1.5", "1".repeat(31)]) {
      expect(() =>
        normalizeVsResult({
          totals: { ourScore: bad, opponentScore: "0" },
          reportedOutcome: null,
          finality: "final",
        }),
      ).toThrow();
    }
  });

  it.each(["won", "lost"] as const)("keeps an explicitly confirmed %s on equal final totals", (outcome) => {
    expect(normalizeVsResult({ totals: { ourScore: "100", opponentScore: "100" }, reportedOutcome: outcome, finality: "final" }).outcome).toBe(outcome);
    expect(() => normalizeVsResult({ totals: { ourScore: "100", opponentScore: "100" }, reportedOutcome: outcome, finality: "unconfirmed" })).toThrow("resultMismatch");
  });
});

describe("parseLocalizedVsTotal", () => {
  it("parses en-US grouping", () => {
    expect(parseLocalizedVsTotal("1,234,567", "en-US")).toBe("1234567");
  });

  it("parses pt-BR grouping", () => {
    expect(parseLocalizedVsTotal("1.234.567", "pt-BR")).toBe("1234567");
  });

  it("rejects malformed grouping for en-US", () => {
    expect(() => parseLocalizedVsTotal("1,23", "en-US")).toThrow();
  });

  it("parses plain digits", () => {
    expect(parseLocalizedVsTotal("1234567", "en-US")).toBe("1234567");
  });
});

describe("formatVsTotal", () => {
  it("formats grouping for en-US and pt-BR", () => {
    expect(formatVsTotal("1234567", "en-US")).toBe("1,234,567");
    expect(formatVsTotal("1234567", "pt-BR")).toBe("1.234.567");
  });

  it("formats zero and values beyond JS-safe integers", () => {
    expect(formatVsTotal("0", "en-US")).toBe("0");
    expect(formatVsTotal("9007199254740993", "en-US")).toBe("9,007,199,254,740,993");
  });

  it("rejects leading zeros, negatives, decimals, and empty input", () => {
    for (const bad of ["", "01", "-1", "1.5", "1,234"]) {
      expect(() => formatVsTotal(bad, "en-US")).toThrow("invalidTotals");
    }
  });
});

describe("assertVsResultDate", () => {
  it("allows unconfirmed results on server today and final results only on past match days", () => {
    expect(() =>
      assertVsResultDate(WEEK, dates[2]!, "2026-09-23", "unconfirmed"),
    ).not.toThrow();
    expect(() =>
      assertVsResultDate(WEEK, dates[1]!, "2026-09-23", "final"),
    ).not.toThrow();
  });

  it("rejects final results on server today", () => {
    expect(() =>
      assertVsResultDate(WEEK, dates[2]!, "2026-09-23", "final"),
    ).toThrow("invalid");
  });

  it("rejects dates after server today for any finality", () => {
    expect(() =>
      assertVsResultDate(WEEK, dates[3]!, "2026-09-23", "unconfirmed"),
    ).toThrow("invalid");
    expect(() =>
      assertVsResultDate(WEEK, dates[3]!, "2026-09-23", "final"),
    ).toThrow("invalid");
  });

  it("rejects dates outside the week and invalid server today", () => {
    expect(() =>
      assertVsResultDate(WEEK, "2026-09-27", "2026-09-28", "unconfirmed"),
    ).toThrow("invalid");
    expect(() =>
      assertVsResultDate(WEEK, dates[0]!, "not-a-date", "unconfirmed"),
    ).toThrow("invalid");
  });
});

describe("calculateVsWeekPoints", () => {
  it("Mon+Tue wins => 3:0, no victory, saturday path open", () => {
    const points = calculateVsWeekPoints(
      WEEK,
      [result(dates[0], "won"), result(dates[1], "won")],
      "2026-09-23",
    );
    expect(points.alliancePoints).toBe(3);
    expect(points.opponentPoints).toBe(0);
    expect(points.remainingPoints).toBe(10);
    expect(points.victory).toBeNull();
    expect(points.saturdayWinSecuresWeek).toBe(true);
  });

  it("Monday win only => saturday path closed", () => {
    const points = calculateVsWeekPoints(
      WEEK,
      [result(dates[0], "won")],
      "2026-09-23",
    );
    expect(points.saturdayWinSecuresWeek).toBe(false);
  });

  it("weekday weights are 1/2/2/2/2 and Saturday is 4", () => {
    const weights = dates.map((d) =>
      calculateVsWeekPoints(WEEK, [result(d, "won")], "2026-09-27").alliancePoints,
    );
    expect(weights).toEqual([1, 2, 2, 2, 2, 4]);
  });

  it("Mon–Thu wins => 7 points and alliance victory", () => {
    const points = calculateVsWeekPoints(
      WEEK,
      dates.slice(0, 4).map((d) => result(d, "won")),
      "2026-09-26",
    );
    expect(points.alliancePoints).toBe(7);
    expect(points.victory).toBe("alliance");
  });

  it("current/future day final rows never award points", () => {
    const points = calculateVsWeekPoints(
      WEEK,
      [result(dates[0], "won"), result("2026-09-23", "won"), result(dates[4], "won")],
      "2026-09-23",
    );
    expect(points.alliancePoints).toBe(1);
  });

  it("duplicate recordedDate throws", () => {
    expect(() =>
      calculateVsWeekPoints(
        WEEK,
        [result(dates[0], "won"), result(dates[0], "lost")],
        "2026-09-23",
      ),
    ).toThrow();
  });

  it("pending Saturday after week end gives no future win hint", () => {
    const points = calculateVsWeekPoints(
      WEEK,
      [result(dates[0], "won"), result(dates[1], "won"), result(dates[2], "won")],
      "2026-09-28",
    );
    expect(points.saturdayWinSecuresWeek).toBe(false);
  });

  it("totals magnitude does not change point weight", () => {
    const huge: VsDayResult = {
      recordedDate: dates[0],
      outcome: "won",
      finality: "final",
      totals: {
        ourScore: "99999999999999999999",
        opponentScore: "1",
      },
    };
    const points = calculateVsWeekPoints(WEEK, [huge], "2026-09-23");
    expect(points.alliancePoints).toBe(1);
  });
});
