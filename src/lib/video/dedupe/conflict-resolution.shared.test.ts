import { describe, expect, it } from "vitest";

import {
  resolveGroupConflicts,
  type ConflictFieldSpec,
} from "@/lib/video/dedupe/conflict-resolution.shared";

type Reading = { amount: number | null; tag: string | null };

const FIELDS: readonly ConflictFieldSpec<Reading>[] = [
  { key: "amount", get: (r) => r.amount },
  {
    key: "tag",
    get: (r) => r.tag,
    isEqual: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
  },
];

describe("resolveGroupConflicts", () => {
  it("resolves with no corrections when every field agrees", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "LFgo" },
      ],
      FIELDS,
    );
    expect(result).toEqual({ resolved: true, corrections: [] });
  });

  it("auto-corrects a minority outlier via majority vote", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "LFgo" },
        { amount: 5000, tag: "LFgo" },
      ],
      FIELDS,
    );
    expect(result).toEqual({
      resolved: true,
      corrections: [{ key: "amount", value: 6000 }],
    });
  });

  it("flags when a field has no majority (2-2 split)", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "LFgo" },
        { amount: 5000, tag: "LFgo" },
        { amount: 5000, tag: "LFgo" },
      ],
      FIELDS,
    );
    expect(result).toEqual({ resolved: false, conflictingFields: ["amount"] });
  });

  it("flags when a field has no majority (bare 1-of-2 split)", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "LFga" },
      ],
      FIELDS,
    );
    expect(result).toEqual({ resolved: false, conflictingFields: ["tag"] });
  });

  it("collects multiple conflicting fields when neither has a majority", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: 5000, tag: "LFga" },
      ],
      FIELDS,
    );
    expect(result).toEqual({
      resolved: false,
      conflictingFields: ["amount", "tag"],
    });
  });

  it("ignores nulls when checking for disagreement", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: null, tag: null },
        { amount: 6000, tag: "LFgo" },
      ],
      FIELDS,
    );
    expect(result).toEqual({ resolved: true, corrections: [] });
  });

  it("treats the custom isEqual comparator as authoritative for both disagreement and majority", () => {
    const result = resolveGroupConflicts(
      [
        { amount: 6000, tag: "LFgo" },
        { amount: 6000, tag: "lfgo" },
        { amount: 6000, tag: "LFGO" },
      ],
      FIELDS,
    );
    expect(result).toEqual({ resolved: true, corrections: [] });
  });
});
