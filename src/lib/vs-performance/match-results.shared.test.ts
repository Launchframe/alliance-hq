import { describe, expect, it } from "vitest";

import {
  calculateVsWeekPoints,
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

describe("calculateVsWeekPoints", () => {
  it("Mon+Tue wins => 3:0, no victory, saturday path open", () => {
    const points = calculateVsWeekPoints(
      WEEK,
      [result(dates[0], "won"), result(dates[1], "won")],
      "2026-09-23",
    );
    expect(points.alliancePoints).toBe(3);
    expect(points.opponentPoints).toBe(0);
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
