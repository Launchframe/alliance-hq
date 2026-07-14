import { describe, expect, it } from "vitest";

import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";
import {
  PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS,
  PRICE_IS_RIGHT_MAX_TICKETS,
  buildPriceIsRightTicketBoard,
  computeMemberTicketCount,
  computeWinProbabilities,
  resolveCliffPoints,
  samplePriceIsRightTicketCurve,
  samplePriceIsRightUniformCurve,
} from "@/lib/trains/train-price-is-right-tickets.shared";

const baseSettings = {
  weightingEnabled: true,
  cliffPoints: null as number | null,
  hardCutoffEnabled: false,
  maxTicketMemberIds: [] as string[],
};

describe("train-price-is-right-tickets.shared", () => {
  it("defaults cliff to 9M when stored null", () => {
    expect(resolveCliffPoints(baseSettings)).toBe(
      PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS,
    );
  });

  it("grants zero tickets below 7.2M floor", () => {
    expect(computeMemberTicketCount(7_199_999, "m1", baseSettings)).toBe(0);
    expect(computeMemberTicketCount(7_200_000, "m1", baseSettings)).toBeGreaterThan(0);
  });

  it("grants max tickets at the sweet spot near 7.2M", () => {
    expect(computeMemberTicketCount(7_200_000, "m1", baseSettings)).toBe(
      PRICE_IS_RIGHT_MAX_TICKETS,
    );
  });

  it("hard cutoff zeroes tickets above cliff", () => {
    const cliff = resolveCliffPoints(baseSettings);
    expect(
      computeMemberTicketCount(cliff + 1, "m1", {
        ...baseSettings,
        hardCutoffEnabled: true,
      }),
    ).toBe(0);
  });

  it("builds board with win probabilities summing to 1", () => {
    const vsScores = new Map([
      ["a", 7_200_000],
      ["b", 8_000_000],
      ["c", 6_000_000],
    ]);
    const { board, missedFloor } = buildPriceIsRightTicketBoard(
      [
        { memberId: "a", memberName: "Alpha" },
        { memberId: "b", memberName: "Bravo" },
        { memberId: "c", memberName: "Charlie" },
      ],
      vsScores,
      baseSettings,
      "b",
    );
    expect(board).toHaveLength(2);
    expect(board.every((row) => row.priorDayVsScore >= PRICE_IS_RIGHT_MIN_VS_SCORE)).toBe(
      true,
    );
    expect(missedFloor).toEqual([
      {
        memberId: "c",
        memberName: "Charlie",
        priorDayVsScore: 6_000_000,
        isViewer: false,
      },
    ]);
    const sum = board.reduce((acc, row) => acc + row.winProbability, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(computeWinProbabilities(board)).toEqual(
      board.map((row) => row.winProbability),
    );
  });

  it("includes >=7.2M members with zero tickets on the main board", () => {
    const cliff = resolveCliffPoints(baseSettings);
    const vsScores = new Map([["a", cliff + 1]]);
    const { board, missedFloor } = buildPriceIsRightTicketBoard(
      [{ memberId: "a", memberName: "Alpha" }],
      vsScores,
      { ...baseSettings, hardCutoffEnabled: true },
    );
    expect(board).toHaveLength(1);
    expect(board[0]?.ticketCount).toBe(0);
    expect(missedFloor).toEqual([]);
  });

  it("never lists the same member on the board and missed floor", () => {
    const vsScores = new Map([
      ["a", 7_200_000],
      ["b", 7_100_000],
      ["c", 8_500_000],
    ]);
    const { board, missedFloor } = buildPriceIsRightTicketBoard(
      [
        { memberId: "a", memberName: "Alpha" },
        { memberId: "b", memberName: "Bravo" },
        { memberId: "c", memberName: "Charlie" },
      ],
      vsScores,
      baseSettings,
    );
    const boardIds = new Set(board.map((row) => row.memberId));
    for (const row of missedFloor) {
      expect(boardIds.has(row.memberId)).toBe(false);
    }
  });

  it("samples a theoretical curve above the floor", () => {
    const curve = samplePriceIsRightTicketCurve(baseSettings, 16);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve[0]!.score).toBeGreaterThanOrEqual(PRICE_IS_RIGHT_MIN_VS_SCORE);
  });

  it("samples a flat equal-odds curve inside the economy band", () => {
    const curve = samplePriceIsRightUniformCurve(
      { thresholdPoints: 8_500_000, fudgePct: 1 },
      32,
    );
    expect(curve.length).toBe(32);
    const inBand = curve.filter((point) => point.tickets === 1);
    const outOfBand = curve.filter((point) => point.tickets === 0);
    expect(inBand.length).toBeGreaterThan(0);
    expect(outOfBand.length).toBeGreaterThan(0);
    const expectedP = 1 / inBand.length;
    for (const point of inBand) {
      expect(point.winProbability).toBeCloseTo(expectedP, 8);
    }
    for (const point of outOfBand) {
      expect(point.winProbability).toBe(0);
    }
  });

  it("returns no uniform curve when threshold filtering is off", () => {
    expect(
      samplePriceIsRightUniformCurve({ thresholdPoints: null, fudgePct: 1 }),
    ).toEqual([]);
  });
});
