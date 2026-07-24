import { describe, expect, it } from "vitest";

import {
  flaggedClusterIdsWithSingleSurvivor,
  groupUnresolvedFlaggedClusters,
  otherLiveClusterRowIds,
} from "@/lib/banks/deposit-slip-flagged-clusters.shared";
import type { DedupeReport } from "@/lib/video/dedupe/merge-report.shared";

const report: DedupeReport = {
  clusters: [
    {
      clusterId: "c1",
      disposition: "flagged",
      reason: "same_commander_timestamp_conflicting_amount_or_term",
      destinationSlipId: "old-a",
      members: [
        { slipId: "old-a", snapshot: { commanderName: "Alpha" } },
        { slipId: "old-b", snapshot: { commanderName: "Beta" } },
      ],
    },
  ],
  autoMergedCount: 0,
  flaggedCount: 1,
  inputCount: 2,
  outputCount: 2,
};

describe("groupUnresolvedFlaggedClusters", () => {
  it("groups live rows by unresolved cluster id", () => {
    const unresolved = new Set(["c1"]);
    const reasons = new Map([["c1", "same_commander_timestamp_conflicting_amount_or_term"]]);
    const groups = groupUnresolvedFlaggedClusters(
      [
        {
          id: "live-1",
          ocrName: "Alpha",
          dedupeClusterId: "c1",
        },
        {
          id: "live-2",
          ocrName: "Beta",
          dedupeClusterId: "c1",
        },
      ],
      unresolved,
      reasons,
      report.clusters,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.clusterId).toBe("c1");
    expect(groups[0]?.liveRows.map((row) => row.id)).toEqual(["live-1", "live-2"]);
    expect(groups[0]?.staleReport).toBe(true);
  });

  it("marks staleReport false when live ids match report members", () => {
    const unresolved = new Set(["c1"]);
    const reasons = new Map([["c1", "same_commander_timestamp_conflicting_amount_or_term"]]);
    const groups = groupUnresolvedFlaggedClusters(
      [
        { id: "old-a", ocrName: "Alpha", dedupeClusterId: "c1" },
        { id: "old-b", ocrName: "Beta", dedupeClusterId: "c1" },
      ],
      unresolved,
      reasons,
      report.clusters,
    );

    expect(groups[0]?.staleReport).toBe(false);
  });
});

describe("otherLiveClusterRowIds", () => {
  it("returns every live row id except the keeper", () => {
    expect(
      otherLiveClusterRowIds(
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        "b",
      ).sort(),
    ).toEqual(["a", "c"]);
  });
});

describe("flaggedClusterIdsWithSingleSurvivor", () => {
  it("lists flagged clusters with exactly one active row", () => {
    expect(
      flaggedClusterIdsWithSingleSurvivor(
        [{ id: "a", dedupeClusterId: "c1" }],
        new Set(["c1"]),
      ),
    ).toEqual([{ clusterId: "c1", survivorId: "a" }]);
  });

  it("returns empty when two rows still share the cluster", () => {
    expect(
      flaggedClusterIdsWithSingleSurvivor(
        [
          { id: "a", dedupeClusterId: "c1" },
          { id: "b", dedupeClusterId: "c1" },
        ],
        new Set(["c1"]),
      ),
    ).toEqual([]);
  });
});
