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
    const board = buildPriceIsRightTicketBoard(
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
    const sum = board.reduce((acc, row) => acc + row.winProbability, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(computeWinProbabilities(board)).toEqual(
      board.map((row) => row.winProbability),
    );
  });

  it("samples a theoretical curve above the floor", () => {
    const curve = samplePriceIsRightTicketCurve(baseSettings, 16);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve[0]!.score).toBeGreaterThanOrEqual(PRICE_IS_RIGHT_MIN_VS_SCORE);
  });
});
