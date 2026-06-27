import { describe, expect, it } from "vitest";

import {
  getExtractionPassComparison,
  getRosterTesseractEvalComparison,
  mergeGroupComparisons,
  parseGroupComparisons,
} from "@/lib/video/group-comparisons.shared";

const passComparison = {
  computedAt: "2026-01-01T00:00:00.000Z",
  passes: [],
  overlapCount: 0,
  onlyInPrimary: 0,
  onlyInShadow: 0,
  recommendedJobId: null,
};

const rosterEval = {
  kind: "roster_tesseract_eval" as const,
  computedAt: "2026-01-01T00:00:00.000Z",
  primaryJobId: "p1",
  shadowJobId: "s1",
  tessPassKey: "roster_ocr_scale_2_psm_6",
  metrics: {
    nameRecall: 0.9,
    namePrecision: 0.85,
    rankAgreement: 0.8,
    powerAgreement: null,
    levelAgreement: null,
    primaryRowCount: 10,
    shadowRowCount: 9,
    rowCountDelta: 1,
    matchedNameCount: 9,
    onlyInPrimary: 1,
    onlyInShadow: 0,
  },
  shadowTotalMs: 1200,
};

describe("parseGroupComparisons", () => {
  it("reads merged shape", () => {
    const parsed = parseGroupComparisons({
      extraction_shadow: passComparison,
      roster_tesseract_eval: rosterEval,
    });
    expect(parsed.extraction_shadow).toEqual(passComparison);
    expect(parsed.roster_tesseract_eval).toEqual(rosterEval);
  });

  it("reads legacy pass comparison blob", () => {
    expect(parseGroupComparisons(passComparison).extraction_shadow).toEqual(
      passComparison,
    );
  });

  it("reads legacy roster eval blob", () => {
    expect(parseGroupComparisons(rosterEval).roster_tesseract_eval).toEqual(
      rosterEval,
    );
  });
});

describe("mergeGroupComparisons", () => {
  it("preserves both kinds when patching one at a time", () => {
    const first = mergeGroupComparisons(null, {
      extraction_shadow: passComparison,
    });
    const merged = mergeGroupComparisons(first, {
      roster_tesseract_eval: rosterEval,
    });
    expect(getExtractionPassComparison(merged)).toEqual(passComparison);
    expect(getRosterTesseractEvalComparison(merged)).toEqual(rosterEval);
  });
});
