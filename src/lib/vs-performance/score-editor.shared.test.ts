import { describe, expect, it } from "vitest";

import {
  buildScoreChanges,
  scoreCellKey,
  validateScoreDraft,
  weeklyScoreMismatch,
  type VsScoreDraft,
  type VsScoreEditCell,
} from "./score-editor.shared";

const cell = (over: Partial<VsScoreEditCell> = {}): VsScoreEditCell => ({
  recordedDate: "2026-09-01",
  period: "daily",
  score: "100",
  source: "hq",
  expectedHeadVersion: 3,
  editable: true,
  canClear: true,
  ...over,
});

const week = (overrides: Array<Partial<VsScoreEditCell>> = []): VsScoreEditCell[] => [
  ...[0, 1, 2, 3, 4, 5].map((index) => cell({ recordedDate: `2026-09-0${index + 1}`, ...(overrides[index] ?? {}) })),
  cell({ recordedDate: "2026-09-06", period: "weekly", score: "700", ...(overrides[6] ?? {}) }),
];

describe("score editor draft", () => {
  it("builds only changed cells, preserving expected head versions and zero sets", () => {
    const cells = week();
    const draft: VsScoreDraft = new Map([
      [scoreCellKey(cells[0]), { operation: "set", value: "0" }],
      [scoreCellKey(cells[2]), { operation: "clear" }],
      [scoreCellKey(cells[6]), { operation: "set", value: "1,000" }],
    ]);
    expect(buildScoreChanges(draft, cells)).toEqual([
      { recordedDate: "2026-09-01", period: "daily", expectedHeadVersion: 3, operation: "set", score: "0" },
      { recordedDate: "2026-09-03", period: "daily", expectedHeadVersion: 3, operation: "clear" },
      { recordedDate: "2026-09-06", period: "weekly", expectedHeadVersion: 3, operation: "set", score: "1,000" },
    ]);
  });

  it("ignores untouched cells entirely", () => {
    expect(buildScoreChanges(new Map(), week())).toEqual([]);
    expect(buildScoreChanges(new Map([[scoreCellKey({ period: "daily", recordedDate: "2000-01-01" }), { operation: "clear" }]]), week())).toEqual([]);
  });

  it("accepts grouped and plain whole numbers, rejects floats and negatives", () => {
    expect(validateScoreDraft(new Map([["a", { operation: "set", value: "1,234,567" }]]))).toBe(true);
    expect(validateScoreDraft(new Map([["a", { operation: "set", value: "0" }]]))).toBe(true);
    expect(validateScoreDraft(new Map([["a", { operation: "clear" }]]))).toBe(true);
    expect(validateScoreDraft(new Map([["a", { operation: "set", value: "1.5" }]]))).toBe(false);
    expect(validateScoreDraft(new Map([["a", { operation: "set", value: "-3" }]]))).toBe(false);
    expect(validateScoreDraft(new Map([["a", { operation: "set", value: "abc" }]]))).toBe(false);
  });

  it("warns when all six known days disagree with the weekly total or exceed it", () => {
    const cells = week([{ score: "100" }, { score: "100" }, { score: "100" }, { score: "100" }, { score: "100" }, { score: "100" }, { score: "700" }]);
    expect(weeklyScoreMismatch(cells, new Map())).toBe(true); // 600 vs 700
    const fixed = week([{}, {}, {}, {}, {}, {}, { score: "600" }]);
    expect(weeklyScoreMismatch(fixed, new Map())).toBe(false);
    // a draft set pushes the sum over the weekly total even with a missing day
    const partial = week([{ score: null }, {}, {}, {}, {}, {}, { score: "400" }]);
    expect(weeklyScoreMismatch(partial, new Map([[scoreCellKey(partial[0]), { operation: "set", value: "1" }]]))).toBe(true); // 501 > 400
    // clearing the weekly total leaves it unknown → no warning
    const cleared = week([{}, {}, {}, {}, {}, {}, { score: "600" }]);
    expect(weeklyScoreMismatch(cleared, new Map([[scoreCellKey(cleared[6]), { operation: "clear" }]]))).toBe(false);
  });

  it("does not warn when the weekly total is unknown or a day is missing", () => {
    const noWeekly = week([{}, {}, {}, {}, {}, {}, { score: null }]);
    expect(weeklyScoreMismatch(noWeekly, new Map())).toBe(false);
    const missing = week([{ score: null }, {}, {}, {}, {}, {}, { score: "600" }]);
    expect(weeklyScoreMismatch(missing, new Map())).toBe(false);
  });
});
