import { describe, expect, it } from "vitest";

import {
  clusterByFuzzyName,
  normalizeEntityName,
} from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import {
  emptyDedupeReport,
  isDedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";
import {
  groupByMinuteTimestamp,
  toMinuteTimestampKey,
} from "@/lib/video/dedupe/timestamp-collision.shared";

describe("video/dedupe helpers", () => {
  it("normalizeEntityName handles Red Ranger junk", () => {
    expect(normalizeEntityName("***Red Ranger")).toBe("red ranger");
    expect(normalizeEntityName("| { #1203[LFgo]Red Ranger")).toBe("red ranger");
  });

  it("clusterByFuzzyName merges near-identical names", () => {
    const clusters = clusterByFuzzyName(
      [{ n: "Rudhy gondrong" }, { n: "Rudhy gondronq" }, { n: "Other" }],
      (r) => r.n,
    );
    expect(clusters.some((c) => c.length >= 2)).toBe(true);
  });

  it("toMinuteTimestampKey + groupByMinuteTimestamp", () => {
    expect(toMinuteTimestampKey("2026-07-11T13:18:26.000Z")).toBe(
      "2026-07-11T13:18",
    );
    const groups = groupByMinuteTimestamp(
      [
        { ts: "2026-07-11T13:18:26.000Z" },
        { ts: "2026-07-11T13:18:01.000Z" },
      ],
      (r) => r.ts,
    );
    expect(groups.get("2026-07-11T13:18")).toHaveLength(2);
  });

  it("isDedupeReport validates shape", () => {
    expect(isDedupeReport(emptyDedupeReport(3))).toBe(true);
    expect(isDedupeReport({})).toBe(false);
  });
});
