import { describe, expect, it } from "vitest";

import {
  clusterDiffKeys,
  depositSlipFollowMeCompatible,
  otherClusterMemberSlipIds,
  useDepositSlipReviewValidation,
} from "@/components/video/DepositSlipVideoReviewTable";
import type {
  DedupeCluster,
  DedupeReport,
} from "@/lib/video/dedupe/merge-report.shared";

describe("depositSlipFollowMeCompatible", () => {
  it("allows Follow-me anchors when sorted by depositAt", () => {
    expect(depositSlipFollowMeCompatible("depositAt")).toBe(true);
  });

  it("suppresses Follow-me anchors when sorted by commander", () => {
    expect(depositSlipFollowMeCompatible("commander")).toBe(false);
  });
});

// Hook-shaped helper is plain logic — call the validation function directly.
describe("useDepositSlipReviewValidation flagged clusters", () => {
  const report: DedupeReport = {
    clusters: [
      {
        clusterId: "c1",
        disposition: "flagged",
        reason: "timestamp_collision_different_commanders",
        destinationSlipId: "a",
        members: [
          { slipId: "a", snapshot: {} },
          { slipId: "b", snapshot: {} },
        ],
      },
    ],
    autoMergedCount: 0,
    flaggedCount: 1,
    inputCount: 2,
    outputCount: 2,
  };

  it("allows submit while two active flagged rows share a cluster", () => {
    const result = useDepositSlipReviewValidation(
      [
        {
          id: "a",
          ocrName: "Alpha",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 0,
        },
        {
          id: "b",
          ocrName: "Beta",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 0,
        },
      ],
      report,
    );
    expect(result.hasUnresolvedFlaggedClusters).toBe(true);
    expect(result.canSubmitSlips).toBe(true);
  });

  it("allows submit after deleting extras in a flagged cluster", () => {
    const result = useDepositSlipReviewValidation(
      [
        {
          id: "a",
          ocrName: "Alpha",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 0,
        },
        {
          id: "b",
          ocrName: "Beta",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "LFgo",
          rosterRankRaw: null,
          dedupeClusterId: "c1",
          deleted: 1,
        },
      ],
      report,
    );
    expect(result.hasUnresolvedFlaggedClusters).toBe(false);
    expect(result.canSubmitSlips).toBe(true);
  });
});

describe("otherClusterMemberSlipIds", () => {
  const cluster: DedupeCluster = {
    clusterId: "c1",
    disposition: "flagged",
    reason: "same_commander_timestamp_conflicting_amount_or_term",
    destinationSlipId: "a",
    members: [
      { slipId: "a", snapshot: {} },
      { slipId: "b", snapshot: {} },
      { slipId: "c", snapshot: {} },
    ],
  };

  it("returns every member slipId except the one being kept", () => {
    expect(otherClusterMemberSlipIds(cluster, "b").sort()).toEqual(["a", "c"]);
  });

  it("returns all members when the kept id isn't in the cluster", () => {
    expect(otherClusterMemberSlipIds(cluster, "z").sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("clusterDiffKeys", () => {
  it("flags fields that disagree across members", () => {
    const cluster: DedupeCluster = {
      clusterId: "c1",
      disposition: "flagged",
      reason: "same_commander_timestamp_conflicting_amount_or_term",
      destinationSlipId: "a",
      members: [
        { slipId: "a", snapshot: { amount: 6000, termDays: 1, allianceTag: "LFgo" } },
        { slipId: "b", snapshot: { amount: 5000, termDays: 1, allianceTag: "LFgo" } },
      ],
    };
    expect(clusterDiffKeys(cluster)).toEqual(new Set(["amount"]));
  });

  it("ignores nulls and returns an empty set when everything agrees", () => {
    const cluster: DedupeCluster = {
      clusterId: "c1",
      disposition: "flagged",
      reason: "same_commander_timestamp_conflicting_amount_or_term",
      destinationSlipId: "a",
      members: [
        { slipId: "a", snapshot: { amount: 6000, termDays: null } },
        { slipId: "b", snapshot: { amount: 6000, termDays: 1 } },
      ],
    };
    expect(clusterDiffKeys(cluster).size).toBe(0);
  });
});
