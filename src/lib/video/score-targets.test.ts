import { describe, expect, it } from "vitest";

import { isVideoOcrAccuracy } from "@/lib/video/ocr-accuracy";
import {
  ENABLED_SCORE_TARGETS,
  SCORE_TARGETS,
  REVIEW_ROW_NUMBER_SCORE_TARGETS,
  getScoreTarget,
  getScoreTargetOrThrow,
  isBankDepositSlipHistoryTarget,
  isDesertStormVideoTarget,
  isHqOnlySubmitTarget,
  isMemberRosterVideoTarget,
  isNativeOnlyVideoTarget,
  isZeroScoreWarningDisabled,
  toScoreTargetClientMeta,
  usesReviewRowNumberIndicator,
} from "@/lib/video/score-targets";

describe("score targets", () => {
  it("returns enabled targets including canyon storm", () => {
    expect(getScoreTarget("desert-storm")?.enabled).toBe(true);
    expect(getScoreTarget("canyon-storm")?.enabled).toBe(true);
    expect(getScoreTarget("alliance-star")?.enabled).toBe(false);
    expect(ENABLED_SCORE_TARGETS.some((target) => target.id === "desert-storm")).toBe(
      true,
    );
    expect(ENABLED_SCORE_TARGETS.some((target) => target.id === "seasonal")).toBe(
      true,
    );
  });

  it("returns undefined for unknown targets", () => {
    expect(getScoreTarget("missing")).toBeUndefined();
  });

  it("returns the target when it exists", () => {
    expect(getScoreTargetOrThrow("desert-storm").id).toBe("desert-storm");
  });

  it("shows match outcome fields only for Desert Storm", () => {
    expect(isDesertStormVideoTarget("desert-storm")).toBe(true);
    expect(isDesertStormVideoTarget("canyon-storm")).toBe(false);
    expect(
      toScoreTargetClientMeta(getScoreTargetOrThrow("desert-storm"))
        .showMatchOutcome,
    ).toBe(true);
    expect(
      toScoreTargetClientMeta(getScoreTargetOrThrow("canyon-storm"))
        .showMatchOutcome,
    ).toBe(false);
  });

  it("throws for unknown targets when required", () => {
    expect(() => getScoreTargetOrThrow("missing")).toThrow(
      "Unknown score target: missing",
    );
  });

  it("disables zero-score review warning only for listed targets", () => {
    expect(isZeroScoreWarningDisabled("zombie-siege")).toBe(true);
    expect(isZeroScoreWarningDisabled("alliance-exercise")).toBe(false);
    expect(isZeroScoreWarningDisabled("desert-storm")).toBe(false);
  });

  it("registers member roster video as HQ-only submit target", () => {
    const target = getScoreTargetOrThrow("member-roster-video");
    expect(isMemberRosterVideoTarget("member-roster-video")).toBe(true);
    expect(isHqOnlySubmitTarget(target)).toBe(true);
    expect(ENABLED_SCORE_TARGETS.some((t) => t.id === "member-roster-video")).toBe(
      true,
    );

    const meta = toScoreTargetClientMeta(target);
    expect(meta.showRosterColumns).toBe(true);
    expect(meta.showScoreColumn).toBe(false);
  });

  it("registers bank deposit slip history as HQ-only native OCR target", () => {
    const target = getScoreTargetOrThrow("bank-deposit-slip-history");
    expect(isBankDepositSlipHistoryTarget("bank-deposit-slip-history")).toBe(
      true,
    );
    expect(isNativeOnlyVideoTarget("bank-deposit-slip-history")).toBe(true);
    expect(isHqOnlySubmitTarget(target)).toBe(true);
    // Enabled after maintainer copy approval for nav.bankDepositSlipHistory.
    expect(target.enabled).toBe(true);

    const meta = toScoreTargetClientMeta(target);
    expect(meta.showDepositSlipColumns).toBe(true);
    expect(meta.showBankSelector).toBe(true);
    expect(meta.showScoreColumn).toBe(false);
    expect(meta.showRosterColumns).toBe(false);
    expect(meta.submitContext).toEqual(["bankId"]);
  });

  it("assigns a valid in-house OCR accuracy to every score target", () => {
    for (const target of SCORE_TARGETS) {
      expect(isVideoOcrAccuracy(target.inHouseOcrAccuracy)).toBe(true);
    }
    expect(getScoreTargetOrThrow("member-roster-video").inHouseOcrAccuracy).toBe(
      "high",
    );
    expect(getScoreTargetOrThrow("desert-storm").inHouseOcrAccuracy).toBe("mid");
    expect(getScoreTargetOrThrow("alliance-star").inHouseOcrAccuracy).toBe(
      "none",
    );
  });

  it("shows read-only row numbers for linear leaderboard video targets", () => {
    for (const id of REVIEW_ROW_NUMBER_SCORE_TARGETS) {
      expect(usesReviewRowNumberIndicator(id)).toBe(true);
      const meta = toScoreTargetClientMeta(getScoreTargetOrThrow(id));
      expect(meta.showReviewRowNumber).toBe(true);
      expect(meta.showRankColumn).toBe(true);
    }
    expect(usesReviewRowNumberIndicator("zombie-siege")).toBe(false);
    expect(
      toScoreTargetClientMeta(getScoreTargetOrThrow("alliance-star"))
        .showReviewRowNumber,
    ).toBe(false);
    expect(
      toScoreTargetClientMeta(getScoreTargetOrThrow("alliance-star"))
        .showRankColumn,
    ).toBe(true);
  });
});
