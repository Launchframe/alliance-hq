import { beforeEach, describe, expect, it } from "vitest";

import {
  coalesceDepositSlips,
  dedupeDepositSlips,
  resetDepositSlipIdCounterForTests,
  splitByDepositAtProximity,
} from "@/lib/banks/deposit-slip-ocr/deposit-slip-dedupe.shared";
import type { ParsedDepositSlipDraft } from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import {
  clusterByFuzzyName,
  normalizeEntityName,
} from "@/lib/video/dedupe/fuzzy-name-cluster.shared";
import {
  groupByMinuteTimestamp,
  hasTimestampCollision,
  toMinuteTimestampKey,
} from "@/lib/video/dedupe/timestamp-collision.shared";

function slip(
  partial: Partial<ParsedDepositSlipDraft> & {
    commanderName: string;
    depositAt?: string | null;
  },
): ParsedDepositSlipDraft {
  return {
    depositAt:
      "depositAt" in partial
        ? (partial.depositAt ?? null)
        : "2026-07-11T13:18:26.000Z",
    termDays: partial.termDays ?? 1,
    amount: partial.amount === undefined ? 6000 : partial.amount,
    status: partial.status ?? "locked",
    outcomeAmount: partial.outcomeAmount ?? null,
    outcomeKind: partial.outcomeKind ?? null,
    outcomeAt: partial.outcomeAt ?? null,
    identity: {
      gameServerNumber: partial.identity?.gameServerNumber ?? 1203,
      allianceTag: partial.identity?.allianceTag ?? "LFgo",
      commanderName: partial.commanderName,
      rawIdentity:
        partial.identity?.rawIdentity ??
        `#1203[LFgo]${partial.commanderName}`,
    },
    sourceFrameIndex: partial.sourceFrameIndex,
    confidence: partial.confidence,
  };
}

describe("toMinuteTimestampKey", () => {
  it("truncates to UTC minute", () => {
    expect(toMinuteTimestampKey("2026-07-11T13:18:26.000Z")).toBe(
      "2026-07-11T13:18",
    );
    expect(toMinuteTimestampKey("2026-07-11T13:18:59.000Z")).toBe(
      "2026-07-11T13:18",
    );
  });

  it("returns null for missing/invalid", () => {
    expect(toMinuteTimestampKey(null)).toBeNull();
    expect(toMinuteTimestampKey("not-a-date")).toBeNull();
  });
});

describe("groupByMinuteTimestamp / hasTimestampCollision", () => {
  it("groups sub-minute variants together", () => {
    const rows = [
      { id: "a", ts: "2026-07-11T13:18:26.000Z", name: "A" },
      { id: "b", ts: "2026-07-11T13:18:01.000Z", name: "B" },
      { id: "c", ts: "2026-07-11T13:19:00.000Z", name: "C" },
    ];
    const groups = groupByMinuteTimestamp(rows, (r) => r.ts);
    expect(groups.get("2026-07-11T13:18")).toHaveLength(2);
    expect(groups.get("2026-07-11T13:19")).toHaveLength(1);
  });

  it("detects collisions across distinct entities", () => {
    const rows = [
      { ts: "2026-07-11T13:18:26.000Z", name: "alpha" },
      { ts: "2026-07-11T13:18:01.000Z", name: "beta" },
    ];
    expect(
      hasTimestampCollision(
        rows,
        (r) => r.ts,
        (r) => r.name,
      ),
    ).toBe(true);
  });
});

describe("normalizeEntityName / clusterByFuzzyName", () => {
  it("strips OCR junk and special characters", () => {
    expect(normalizeEntityName(": #1203[LFgo]GoGoGoNB1")).toBe("gogogonb1");
    expect(normalizeEntityName("Red Ranger***")).toBe("red ranger");
    expect(normalizeEntityName("| Fr #1203[LFgo]Lady Raider")).toBe(
      "lady raider",
    );
  });

  it("clusters Red Ranger OCR variants", () => {
    const rows = [
      { name: "***Red Ranger" },
      { name: "Red Ranger" },
      { name: "| { #1203[LFgo]Red Ranger" },
    ];
    const clusters = clusterByFuzzyName(rows, (r) => r.name);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });
});

describe("coalesceDepositSlips", () => {
  it("prefers matured over locked and fills nulls", () => {
    const merged = coalesceDepositSlips([
      slip({
        commanderName: "GoGoGoNB1",
        status: "locked",
        amount: null,
        termDays: null,
      }),
      slip({
        commanderName: "GoGoGoNB1",
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
        amount: 6000,
        termDays: 1,
      }),
    ]);
    expect(merged.status).toBe("matured");
    expect(merged.amount).toBe(6000);
    expect(merged.termDays).toBe(1);
    expect(merged.outcomeAmount).toBe(6840);
  });

  it("picks the minimum sourceFrameIndex across the merged group", () => {
    const merged = coalesceDepositSlips([
      slip({
        commanderName: "FramePick",
        sourceFrameIndex: 42,
        amount: 6000,
        termDays: 1,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
      }),
      slip({
        commanderName: "FramePick",
        sourceFrameIndex: 5,
        amount: null,
        termDays: null,
        status: "locked",
      }),
      slip({
        commanderName: "FramePick",
        sourceFrameIndex: 17,
        amount: 6000,
        termDays: 1,
      }),
    ]);
    expect(merged.sourceFrameIndex).toBe(5);
  });
});

describe("dedupeDepositSlips", () => {
  beforeEach(() => {
    resetDepositSlipIdCounterForTests();
  });

  it("auto-merges GoGoGoNB1 locked+matured duplicates", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "GoGoGoNB1",
        status: "locked",
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "GoGoGoNB1",
          rawIdentity: ": #1203[LFgo]GoGoGoNB1",
        },
      }),
      slip({
        commanderName: "GoGoGoNB1",
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "GoGoGoNB1",
          rawIdentity: "#1203[LFgo]GoGoGoNB1",
        },
      }),
      slip({
        commanderName: "GoGoGoNB1",
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "GoGoGoNB1",
          rawIdentity: "> #1203[LFgo]GoGoGoNB1",
        },
      }),
      slip({
        commanderName: "GoGoGoNB1",
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
      }),
    ]);
    expect(slips).toHaveLength(1);
    expect(slips[0]?.status).toBe("matured");
    expect(slips[0]?.outcomeAmount).toBe(6840);
    expect(report.autoMergedCount).toBe(3);
    expect(report.clusters[0]?.disposition).toBe("auto_merged");
  });

  it("auto-merges Rudhy fuzzy name variants", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Rudhy gondrong",
        depositAt: "2026-07-10T22:20:54.000Z",
        termDays: 3,
      }),
      slip({
        commanderName: "Rudhy gondrong",
        depositAt: "2026-07-10T22:20:12.000Z",
        termDays: 3,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "Rudhy gondrong",
          rawIdentity: "xx #1203[LFgo]Rudhy gondrong",
        },
      }),
      slip({
        commanderName: "Rudhy gondronq",
        depositAt: "2026-07-10T22:20:54.000Z",
        termDays: 3,
      }),
    ]);
    expect(slips).toHaveLength(1);
    expect(report.autoMergedCount).toBeGreaterThanOrEqual(1);
  });

  it("coalesces partial Can Thu into complete row", () => {
    const { slips } = dedupeDepositSlips([
      slip({
        commanderName: "Can Thu",
        depositAt: "2026-07-10T19:05:43.000Z",
        amount: null,
        termDays: null,
      }),
      slip({
        commanderName: "Can Thu",
        depositAt: "2026-07-10T19:05:43.000Z",
        amount: 6000,
        termDays: 1,
      }),
    ]);
    expect(slips).toHaveLength(1);
    expect(slips[0]?.amount).toBe(6000);
    expect(slips[0]?.termDays).toBe(1);
  });

  it("does not flag distinct, dissimilar commanders that merely share a deposit minute", () => {
    // Bank-capture flood waves routinely land many unrelated depositors in the
    // same minute — that alone isn't suspicious. Only similar-looking names
    // sharing a minute warrant review (covered by the borderline-fuzzy tests
    // below), so two clearly different commanders should pass through untouched.
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "AlphaPlayer",
        depositAt: "2026-07-11T10:00:15.000Z",
      }),
      slip({
        commanderName: "BetaPlayer",
        depositAt: "2026-07-11T10:00:42.000Z",
      }),
    ]);
    expect(slips).toHaveLength(2);
    expect(report.flaggedCount).toBe(0);
    expect(report.clusters).toHaveLength(0);
    expect(slips.every((s) => !s.dedupeClusterId)).toBe(true);
  });

  it("flags same commander+minute with conflicting amounts", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "FrankCastle00",
        depositAt: "2026-07-11T13:22:39.000Z",
        amount: 6000,
        termDays: 3,
      }),
      slip({
        commanderName: "FrankCastle00",
        depositAt: "2026-07-11T13:22:39.000Z",
        amount: 9000,
        termDays: 3,
      }),
    ]);
    expect(slips).toHaveLength(2);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_timestamp_conflicting_amount_or_term",
    );
  });

  it("flags same commander+minute with conflicting explicit identity", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "ShadowFox",
        depositAt: "2026-07-11T13:22:39.000Z",
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "ShadowFox",
          rawIdentity: "#1203[LFgo]ShadowFox",
        },
      }),
      slip({
        commanderName: "ShadowFox",
        depositAt: "2026-07-11T13:22:39.000Z",
        identity: {
          gameServerNumber: 1204,
          allianceTag: "Roar",
          commanderName: "ShadowFox",
          rawIdentity: "#1204[Roar]ShadowFox",
        },
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(report.autoMergedCount).toBe(0);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_timestamp_conflicting_identity",
    );
    expect(slips.every((s) => s.dedupeClusterId)).toBe(true);
  });

  it("flags transitive fuzzy chains instead of auto-merging endpoints", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "AlphaPlayer00",
        depositAt: "2026-07-11T13:22:39.000Z",
      }),
      slip({
        commanderName: "AlphaPlaver00",
        depositAt: "2026-07-11T13:22:39.000Z",
      }),
      slip({
        commanderName: "BlphaPlaver00",
        depositAt: "2026-07-11T13:22:39.000Z",
      }),
    ]);

    expect(slips).toHaveLength(3);
    expect(report.autoMergedCount).toBe(0);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.disposition).toBe("flagged");
    expect(report.clusters[0]?.reason).toBe("borderline_commander_name_same_minute");
    expect(slips.every((s) => s.dedupeClusterId)).toBe(true);
  });

  it("leaves distinct minutes alone", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "SameName",
        depositAt: "2026-07-11T13:18:26.000Z",
      }),
      slip({
        commanderName: "SameName",
        depositAt: "2026-07-10T13:18:26.000Z",
      }),
    ]);
    expect(slips).toHaveLength(2);
    expect(report.clusters).toHaveLength(0);
  });

  it("auto-merges same commander when OCR misreads the minute by a digit", () => {
    // Modeled on job OIrb8ejUMyAkHv4S / Ranger 275: identical commander name
    // split across nearby minute buckets because OCR flipped a digit.
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:18:26.000Z",
        amount: 6000,
        termDays: 1,
        sourceFrameIndex: 5,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:28:26.000Z",
        amount: 6000,
        termDays: 1,
        sourceFrameIndex: 40,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:18:40.000Z",
        amount: 6000,
        termDays: 1,
        sourceFrameIndex: 6,
      }),
    ]);
    expect(slips).toHaveLength(1);
    expect(report.autoMergedCount).toBe(2);
    expect(slips[0]?.sourceFrameIndex).toBe(5);
  });

  it("keeps genuinely distant same-commander deposits as separate slips", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:18:26.000Z",
        amount: 6000,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T16:45:00.000Z",
        amount: 9000,
      }),
    ]);
    expect(slips).toHaveLength(2);
    expect(report.autoMergedCount).toBe(0);
    expect(report.clusters).toHaveLength(0);
  });

  it("does not let a majority minute swallow a second oversampled distant deposit", () => {
    // 3 OCR reads of 13:18 must not absorb 2 OCR reads of 16:45 just because
    // 13:18 wins a strict majority and amounts/terms agree.
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:18:26.000Z",
        amount: 6000,
        termDays: 1,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:18:30.000Z",
        amount: 6000,
        termDays: 1,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T13:18:40.000Z",
        amount: 6000,
        termDays: 1,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T16:45:00.000Z",
        amount: 6000,
        termDays: 1,
      }),
      slip({
        commanderName: "Ranger 275",
        depositAt: "2026-07-11T16:45:10.000Z",
        amount: 6000,
        termDays: 1,
      }),
    ]);
    expect(slips).toHaveLength(2);
    expect(report.autoMergedCount).toBe(3);
    const minutes = slips
      .map((s) => toMinuteTimestampKey(s.depositAt))
      .sort();
    expect(minutes).toEqual(["2026-07-11T13:18", "2026-07-11T16:45"]);
  });

  it("absorbs a lone OCR outlier near a majority-minute home", () => {
    // Majority at 13:18; singleton at 13:48 (tens-digit OCR flip) still merges.
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Outlier",
        depositAt: "2026-07-11T13:18:26.000Z",
        amount: 6000,
      }),
      slip({
        commanderName: "Outlier",
        depositAt: "2026-07-11T13:18:30.000Z",
        amount: 6000,
      }),
      slip({
        commanderName: "Outlier",
        depositAt: "2026-07-11T13:18:40.000Z",
        amount: 6000,
      }),
      slip({
        commanderName: "Outlier",
        depositAt: "2026-07-11T13:48:00.000Z",
        amount: 6000,
      }),
    ]);
    expect(slips).toHaveLength(1);
    expect(report.autoMergedCount).toBe(3);
  });

  it("does not chain many spaced deposits into one proximity mega-merge", () => {
    // Diameter-capped proximity: 12-minute steps spanning 36 minutes must not
    // collapse into a single slip.
    const { slips } = dedupeDepositSlips([
      slip({
        commanderName: "Chain",
        depositAt: "2026-07-11T13:00:00.000Z",
      }),
      slip({
        commanderName: "Chain",
        depositAt: "2026-07-11T13:12:00.000Z",
      }),
      slip({
        commanderName: "Chain",
        depositAt: "2026-07-11T13:24:00.000Z",
      }),
      slip({
        commanderName: "Chain",
        depositAt: "2026-07-11T13:36:00.000Z",
      }),
    ]);
    expect(slips.length).toBeGreaterThanOrEqual(2);
  });
});

describe("splitByDepositAtProximity", () => {
  it("caps group diameter so consecutive gaps cannot chain forever", () => {
    const rows = [
      { id: "a", ts: "2026-07-11T13:00:00.000Z" },
      { id: "b", ts: "2026-07-11T13:12:00.000Z" },
      { id: "c", ts: "2026-07-11T13:24:00.000Z" },
      { id: "d", ts: "2026-07-11T13:36:00.000Z" },
    ];
    const { anchoredGroups, unanchored } = splitByDepositAtProximity(
      rows,
      (r) => r.ts,
    );
    expect(unanchored).toHaveLength(0);
    expect(anchoredGroups).toHaveLength(2);
    expect(anchoredGroups[0]?.map((r) => r.id)).toEqual(["a", "b"]);
    expect(anchoredGroups[1]?.map((r) => r.id)).toEqual(["c", "d"]);
  });
});

// Regression fixtures modeled directly on job O3DSiQGyvAGG6iM6, where the old
// boolean conflict gates flagged whole clusters instead of correcting an
// obvious OCR outlier, and rows with no parseable timestamp never got a chance
// to match their otherwise-identical duplicates.
describe("dedupeDepositSlips — majority-vote conflict resolution", () => {
  beforeEach(() => {
    resetDepositSlipIdCounterForTests();
  });

  it("auto-merges Tanker KM with a 5-of-6 amount majority and a 4-of-6 tag majority", () => {
    const depositAt = "2026-07-12T04:30:17.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "Tanker KM", depositAt, amount: 6000, identity: { gameServerNumber: 1203, allianceTag: "LFgo", commanderName: "Tanker KM", rawIdentity: "#1203[LFgo]Tanker KM" } }),
      slip({ commanderName: "Tanker KM", depositAt, amount: 5000, identity: { gameServerNumber: 1203, allianceTag: "LFgo", commanderName: "Tanker KM", rawIdentity: "#1203[LFgo]Tanker KM" } }),
      slip({ commanderName: "Tanker KM", depositAt, amount: 6000, identity: { gameServerNumber: 1203, allianceTag: "LFgo", commanderName: "Tanker KM", rawIdentity: "#1203[LFgo]Tanker KM" } }),
      slip({ commanderName: "Tanker KM", depositAt, amount: 6000, identity: { gameServerNumber: 1203, allianceTag: "LFga", commanderName: "Tanker KM", rawIdentity: "#1203[LFga]Tanker KM" } }),
      slip({ commanderName: "Tanker KM", depositAt, amount: 6000, identity: { gameServerNumber: 1203, allianceTag: "LFga", commanderName: "Tanker KM", rawIdentity: "#1203[LFga]Tanker KM" } }),
      slip({ commanderName: "Tanker KM", depositAt, amount: 6000, identity: { gameServerNumber: 1203, allianceTag: "LFgo", commanderName: "Tanker KM", rawIdentity: "#1203[LFgo]Tanker KM" } }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.amount).toBe(6000);
    expect(slips[0]?.identity.allianceTag).toBe("LFgo");
    expect(report.autoMergedCount).toBe(5);
    expect(report.flaggedCount).toBe(0);
    expect(report.clusters[0]?.disposition).toBe("auto_merged");
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_and_minute_timestamp_majority_corrected",
    );
    expect(report.clusters[0]?.correctedFields).toEqual(
      expect.arrayContaining(["amount", "allianceTag"]),
    );
  });

  it("auto-merges Bat Pig with a 4-of-5 termDays majority", () => {
    const depositAt = "2026-07-11T22:25:32.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "Bat Pig", depositAt, amount: 6000, termDays: 1 }),
      slip({ commanderName: "Bat Pig", depositAt, amount: 6000, termDays: 1 }),
      slip({ commanderName: "Bat Pig", depositAt, amount: 6000, termDays: 1 }),
      slip({ commanderName: "Bat Pig", depositAt, amount: 6000, termDays: 1 }),
      slip({ commanderName: "Bat Pig", depositAt, amount: 6000, termDays: 3 }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.termDays).toBe(1);
    expect(report.autoMergedCount).toBe(4);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_and_minute_timestamp_majority_corrected",
    );
    expect(report.clusters[0]?.correctedFields).toEqual(["termDays"]);
  });

  it("still flags a genuine 2-2 amount split with no majority", () => {
    const depositAt = "2026-07-11T13:22:39.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "TieBreaker", depositAt, amount: 6000 }),
      slip({ commanderName: "TieBreaker", depositAt, amount: 6000 }),
      slip({ commanderName: "TieBreaker", depositAt, amount: 5000 }),
      slip({ commanderName: "TieBreaker", depositAt, amount: 5000 }),
    ]);

    expect(slips).toHaveLength(4);
    expect(report.autoMergedCount).toBe(0);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_timestamp_conflicting_amount_or_term",
    );
    expect(slips.every((s) => s.dedupeClusterId)).toBe(true);
  });
});

describe("dedupeDepositSlips — missing-timestamp reconciliation", () => {
  beforeEach(() => {
    resetDepositSlipIdCounterForTests();
  });

  it("folds EagleTN's timestamp-less duplicates into the one timestamped row", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "EagleTN",
        depositAt: "2026-07-11T22:25:31.000Z",
        amount: 6000,
        termDays: 1,
      }),
      slip({ commanderName: "EagleTN", depositAt: null, amount: 6000, termDays: 1 }),
      slip({ commanderName: "EagleTN", depositAt: null, amount: 6000, termDays: 1 }),
      slip({ commanderName: "EagleTN", depositAt: null, amount: 6000, termDays: 1 }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.depositAt).toBe("2026-07-11T22:25:31.000Z");
    expect(report.autoMergedCount).toBe(3);
    expect(
      report.clusters.some(
        (c) =>
          c.reason === "redundant_missing_timestamp" ||
          c.reason === "commander_match_missing_timestamp",
      ),
    ).toBe(true);
  });

  it("merges timestamp-less duplicates with each other when no anchored row exists", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "EnganaRuca$", depositAt: null, amount: 6000, termDays: 1 }),
      slip({ commanderName: "EnganaRucas", depositAt: null, amount: 6000, termDays: 1 }),
    ]);

    expect(slips).toHaveLength(1);
    expect(report.autoMergedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe("commander_match_missing_timestamp");
  });

  it("flags a timestamp-less row when it conflicts with its best name match", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "CAIPIRA",
        depositAt: "2026-07-11T22:25:32.000Z",
        amount: 6000,
      }),
      slip({ commanderName: "CAIPIRA", depositAt: null, amount: 9000 }),
    ]);

    expect(slips).toHaveLength(2);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "commander_match_missing_timestamp_ambiguous",
    );
    expect(
      report.clusters[0]?.members.some(
        (m) => m.slipId === slips.find((s) => s.depositAt == null)?.slipId,
      ),
    ).toBe(true);
    expect(
      report.clusters[0]?.members.some(
        (m) =>
          m.slipId === slips.find((s) => s.depositAt != null)?.slipId,
      ),
    ).toBe(false);
  });

  it("does not mislabel an undated row as sharing a timestamp with a dated deposit (jamesBueller89)", () => {
    const datedAt = "2026-07-18T22:29:27.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "jamesBueller89",
        depositAt: datedAt,
        amount: 6000,
        termDays: 5,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
      }),
      slip({
        commanderName: "jamesBueller89",
        depositAt: null,
        amount: 6000,
        termDays: 3,
        status: "locked",
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "commander_match_missing_timestamp_ambiguous",
    );
    expect(
      report.clusters.some((c) =>
        c.reason === "same_commander_timestamp_conflicting_amount_or_term",
      ),
    ).toBe(false);
    const datedSlip = slips.find((s) => s.depositAt === datedAt);
    const undatedSlip = slips.find((s) => s.depositAt == null);
    expect(datedSlip?.dedupeClusterId).toBeFalsy();
    expect(undatedSlip?.dedupeClusterId).toBeTruthy();
  });

  it("leaves a truly unique timestamp-less commander untouched", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "SomeoneElse",
        depositAt: "2026-07-11T22:25:32.000Z",
        amount: 6000,
      }),
      slip({ commanderName: "CompletelyDifferentNameXYZ", depositAt: null, amount: 6000 }),
    ]);

    expect(slips).toHaveLength(2);
    expect(report.clusters).toHaveLength(0);
  });

  it("folds timestamp-less row into an auto-merged destination (not just singletons)", () => {
    // GrandMaster has two same-minute readings that auto-merge into a synthetic
    // destination. A third GrandMaster reading has no timestamp at all — it must
    // still fold into the auto-merged destination rather than surviving as an
    // orphan singleton (regression for the perMinuteDestinations filter bug that
    // excluded auto-merged destinations from anchor candidates).
    const depositAt = "2026-07-11T22:25:31.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "GrandMaster", depositAt, amount: 6000, termDays: 1 }),
      slip({ commanderName: "GrandMaster", depositAt, amount: 6000, termDays: 1 }),
      slip({ commanderName: "GrandMaster", depositAt: null, amount: 6000, termDays: 1 }),
    ]);

    expect(slips).toHaveLength(1);
    expect(report.autoMergedCount).toBeGreaterThanOrEqual(2);
    expect(slips[0]?.identity.commanderName).toBe("GrandMaster");
    // Exact-name clustering merges the unanchored row in the same pass as the
    // timestamped duplicates (no separate missing-timestamp cluster).
    expect(report.clusters.some((c) => c.disposition === "auto_merged")).toBe(
      true,
    );
  });
});

// Regression fixtures modeled directly on job JenznlPcbHrlpkyU, where phase-3's
// heuristics still missed several real duplicates and over-flagged unrelated
// commanders that merely shared a deposit minute during a flood wave.
describe("dedupeDepositSlips — batch-frequency tag tiebreak", () => {
  it("auto-merges a 1-of-2 alliance-tag split when one tag dominates the whole batch (Lady Raider)", () => {
    const depositAt = "2026-07-11T22:32:02.000Z";
    // 49 other rows carry the common tag; only this one pair disagrees.
    const filler = Array.from({ length: 49 }, (_, i) =>
      slip({
        commanderName: `Filler${i}`,
        depositAt: `2026-07-11T20:${String(i % 60).padStart(2, "0")}:00.000Z`,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: `Filler${i}`,
          rawIdentity: `#1203[LFgo]Filler${i}`,
        },
      }),
    );

    const { slips, report } = dedupeDepositSlips([
      ...filler,
      slip({
        commanderName: "Lady Raider",
        depositAt,
        termDays: 3,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFga",
          commanderName: "Lady Raider",
          rawIdentity: "Fo #1203[LFga]Lady Raider",
        },
      }),
      slip({
        commanderName: "Lady Raider",
        depositAt,
        termDays: 3,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "Lady Raider",
          rawIdentity: "Fats 1 #1203[LFgo]Lady Raider",
        },
      }),
    ]);

    const ladyRaider = slips.find((s) => s.identity.commanderName === "Lady Raider");
    expect(ladyRaider).toBeDefined();
    expect(ladyRaider?.identity.allianceTag).toBe("LFgo");
    expect(
      report.clusters.find((c) => c.destinationSlipId === ladyRaider?.slipId)
        ?.disposition,
    ).toBe("auto_merged");
    expect(
      report.clusters.find((c) => c.destinationSlipId === ladyRaider?.slipId)
        ?.correctedFields,
    ).toEqual(["allianceTag"]);
  });

  it("still flags an alliance-tag split when neither tag has a clear batch majority", () => {
    const depositAt = "2026-07-11T22:32:02.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "EvenSplit",
        depositAt,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "AAAA",
          commanderName: "EvenSplit",
          rawIdentity: "#1203[AAAA]EvenSplit",
        },
      }),
      slip({
        commanderName: "EvenSplit",
        depositAt,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "BBBB",
          commanderName: "EvenSplit",
          rawIdentity: "#1203[BBBB]EvenSplit",
        },
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_timestamp_conflicting_identity",
    );
  });

  it("still flags wholly different alliance tags despite a dominant batch frequency", () => {
    const depositAt = "2026-07-11T22:32:02.000Z";
    const filler = Array.from({ length: 48 }, (_, i) =>
      slip({
        commanderName: `Filler${i}`,
        depositAt: `2026-07-11T20:${String(i).padStart(2, "0")}:00.000Z`,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: `Filler${i}`,
          rawIdentity: `#1203[LFgo]Filler${i}`,
        },
      }),
    );
    const { slips, report } = dedupeDepositSlips([
      ...filler,
      slip({
        commanderName: "SharedName",
        depositAt,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "SharedName",
          rawIdentity: "#1203[LFgo]SharedName",
        },
      }),
      slip({
        commanderName: "SharedName",
        depositAt,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "ROAR",
          commanderName: "SharedName",
          rawIdentity: "#1203[ROAR]SharedName",
        },
      }),
    ]);

    expect(slips.filter((s) => s.identity.commanderName === "SharedName")).toHaveLength(
      2,
    );
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_timestamp_conflicting_identity",
    );
  });

  it("still flags a lower-count unrelated tag beside a tied pair of OCR variants", () => {
    const depositAt = "2026-07-11T22:32:02.000Z";
    const filler = Array.from({ length: 45 }, (_, i) =>
      slip({
        commanderName: `Filler${i}`,
        depositAt: `2026-07-11T20:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    );
    const shared = (allianceTag: string) =>
      slip({
        commanderName: "SharedName",
        depositAt,
        identity: {
          gameServerNumber: 1203,
          allianceTag,
          commanderName: "SharedName",
          rawIdentity: `#1203[${allianceTag}]SharedName`,
        },
      });

    const { slips, report } = dedupeDepositSlips([
      ...filler,
      shared("LFgo"),
      shared("LFgo"),
      shared("LFga"),
      shared("LFga"),
      shared("ROAR"),
    ]);

    expect(slips.filter((s) => s.identity.commanderName === "SharedName")).toHaveLength(
      5,
    );
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "same_commander_timestamp_conflicting_identity",
    );
  });

  it("still flags a lookalike-tag split when the batch signal is too small", () => {
    const depositAt = "2026-07-11T22:32:02.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "Filler1" }),
      slip({ commanderName: "Filler2" }),
      slip({
        commanderName: "SmallBatch",
        depositAt,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFga",
          commanderName: "SmallBatch",
          rawIdentity: "#1203[LFga]SmallBatch",
        },
      }),
      slip({ commanderName: "SmallBatch", depositAt }),
    ]);

    expect(slips.filter((s) => s.identity.commanderName === "SmallBatch")).toHaveLength(
      2,
    );
    expect(report.flaggedCount).toBe(1);
  });
});

describe("dedupeDepositSlips — implausible timestamp outliers", () => {
  it("reconciles an impossible-year timestamp in a tiny batch", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "EnganaRucas",
        depositAt: "2026-07-12T04:16:48.000Z",
      }),
      slip({
        commanderName: "EnganaRucas",
        depositAt: "0256-07-12T04:16:48.000Z",
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.depositAt).toBe("2026-07-12T04:16:48.000Z");
    expect(report.autoMergedCount).toBe(1);
  });

  it("reclassifies a wildly-off-year timestamp as anchorless and folds it into its real duplicate (EnganaRucas)", () => {
    // Five ordinary same-day rows establish a reliable batch median, plus the
    // EnganaRucas trio: one correctly timestamped, one with a garbled year
    // (0256 instead of 2026 — a single OCR digit swap), one with no timestamp
    // at all.
    const filler = Array.from({ length: 5 }, (_, i) =>
      slip({
        commanderName: `Filler${i}`,
        depositAt: `2026-07-12T0${i}:16:48.000Z`,
      }),
    );

    const { slips, report } = dedupeDepositSlips([
      ...filler,
      slip({
        commanderName: "EnganaRucas",
        depositAt: "2026-07-12T04:16:48.000Z",
        termDays: 1,
      }),
      slip({
        commanderName: "EnganaRucas",
        depositAt: "0256-07-12T04:16:48.000Z",
        termDays: 1,
      }),
      slip({
        commanderName: "EnganaRuca$",
        depositAt: null,
        termDays: 1,
      }),
    ]);

    const enganaRucas = slips.filter((s) =>
      s.identity.commanderName.toLowerCase().startsWith("enganaruc"),
    );
    expect(enganaRucas).toHaveLength(1);
    expect(enganaRucas[0]?.depositAt).toBe("2026-07-12T04:16:48.000Z");
    expect(
      report.clusters.some((c) => c.reason === "commander_match_missing_timestamp"),
    ).toBe(true);
  });

  it("leaves plausible timestamps in distinct per-minute buckets alone", () => {
    const filler = Array.from({ length: 5 }, (_, i) =>
      slip({
        commanderName: `Filler${i}`,
        depositAt: `2026-07-12T0${i}:16:48.000Z`,
      }),
    );
    const { slips, report } = dedupeDepositSlips([...filler]);
    expect(slips).toHaveLength(5);
    expect(report.clusters).toHaveLength(0);
  });
});

describe("dedupeDepositSlips — folding missing-timestamp rows into an already-flagged cluster", () => {
  it("folds a third fuzzy-matching name into an existing borderline cluster instead of opening a redundant one (ND/NO/IND 770320)", () => {
    const depositAt = "2026-07-12T01:12:31.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "NO 770320",
        depositAt,
        termDays: 3,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "S2BY",
          commanderName: "NO 770320",
          rawIdentity: "| i #1203[S2BY]NO 770320",
        },
      }),
      slip({
        commanderName: "IND 770320",
        depositAt,
        termDays: 3,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "S2BY",
          commanderName: "IND 770320",
          rawIdentity: "| °F #1203[S2BY]IND 770320",
        },
      }),
      slip({
        commanderName: "ND 770320",
        depositAt: null,
        termDays: 3,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "S2BY",
          commanderName: "ND 770320",
          rawIdentity: "bi #1203[S2BY]ND 770320",
        },
      }),
    ]);

    expect(slips).toHaveLength(3);
    const clusterIds = new Set(slips.map((s) => s.dedupeClusterId).filter(Boolean));
    // All three should land in exactly one shared flagged cluster, not two.
    expect(clusterIds.size).toBe(1);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.members).toHaveLength(3);
  });

  it("folds an anchorless row into an already-flagged cluster even when it fuzzy-matches only one of that cluster's members", () => {
    // "Commande" is a >=0.85 fuzzy match for "Commander" alone (not for
    // "Commandersz", whose similarity to "Commande" falls below the
    // auto-merge threshold) — so it has exactly one matched destination, not
    // two. That destination is already part of a flagged borderline-name
    // cluster with "Commandersz". Before the fix, `matchedDestinations.length
    // > 1` excluded this single-match case, so the anchorless row opened a
    // redundant second flagged cluster for the same disputed identity instead
    // of joining the existing one.
    const depositAt = "2026-07-12T01:12:31.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "Commander", depositAt, amount: 6000 }),
      slip({ commanderName: "Commandersz", depositAt, amount: 6000 }),
      slip({ commanderName: "Commande", depositAt: null, amount: 9000 }),
    ]);

    expect(slips).toHaveLength(3);
    const clusterIds = new Set(slips.map((s) => s.dedupeClusterId).filter(Boolean));
    expect(clusterIds.size).toBe(1);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.members).toHaveLength(3);
  });

  it("folds a compatible anchorless match into its destination's existing flagged cluster", () => {
    const depositAt = "2026-07-12T01:12:31.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "Commander", depositAt, amount: 6000 }),
      slip({ commanderName: "Commandersz", depositAt, amount: 6000 }),
      slip({
        commanderName: "Commande",
        depositAt: null,
        amount: 6000,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 6840,
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(report.clusters).toHaveLength(1);
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.disposition).toBe("flagged");
    expect(report.clusters[0]?.members).toHaveLength(3);
    const clusterId = report.clusters[0]?.clusterId;
    expect(clusterId).toBeDefined();
    expect(slips.every((s) => s.dedupeClusterId === clusterId)).toBe(true);
  });
});

describe("dedupeDepositSlips — review triage", () => {
  it("auto-merges identical display-identity duplicates instead of flagging", () => {
    const depositAt = "2026-07-11T13:18:26.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({ commanderName: "Red Panda Squad", depositAt, amount: 4500 }),
      slip({ commanderName: "Red Panda Squad", depositAt, amount: 4500 }),
      slip({
        commanderName: "Red Panda Squad",
        depositAt: "2026-07-11T13:18:40.000Z",
        amount: 4500,
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(report.flaggedCount).toBe(0);
    expect(report.autoMergedCount).toBeGreaterThanOrEqual(1);
    expect(
      report.clusters.some((c) => c.reason === "exact_display_identity"),
    ).toBe(true);
  });

  it("merges locked + matured within the term window into one survivor with outcomeAt", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Myster X Zero",
        depositAt: "2026-07-10T12:00:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "Myster X Zero",
        depositAt: "2026-07-11T14:30:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 5700,
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.status).toBe("matured");
    expect(slips[0]?.depositAt).toBe("2026-07-10T12:00:00.000Z");
    expect(slips[0]?.outcomeAt).toBe("2026-07-11T14:30:00.000Z");
    expect(report.flaggedCount).toBe(0);
    expect(
      report.clusters.some((c) => c.reason === "lifecycle_locked_to_matured"),
    ).toBe(true);
  });

  it("merges locked + looted within the term window", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Loot Pair",
        depositAt: "2026-07-10T08:00:00.000Z",
        amount: 3000,
        termDays: 3,
        status: "locked",
      }),
      slip({
        commanderName: "Loot Pair",
        depositAt: "2026-07-12T09:00:00.000Z",
        amount: 3000,
        termDays: 3,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 0,
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.status).toBe("looted");
    expect(slips[0]?.depositAt).toBe("2026-07-10T08:00:00.000Z");
    expect(slips[0]?.outcomeAt).toBe("2026-07-12T09:00:00.000Z");
    expect(
      report.clusters.some((c) => c.reason === "lifecycle_locked_to_looted"),
    ).toBe(true);
  });

  it("absorbs a missing-timestamp twin that exactly matches one kept deposit", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "E Ron",
        depositAt: "2026-07-11T10:00:00.000Z",
        amount: 4500,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "E Ron",
        depositAt: null,
        amount: 4500,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "E Ron",
        depositAt: null,
        amount: 4500,
        termDays: 1,
        status: "locked",
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.depositAt).toBe("2026-07-11T10:00:00.000Z");
    expect(report.flaggedCount).toBe(0);
    const redundant = report.clusters.filter(
      (c) => c.reason === "redundant_missing_timestamp",
    );
    expect(redundant.length).toBeGreaterThanOrEqual(1);
    expect(
      redundant.reduce(
        (n, c) =>
          n + c.members.filter((m) => m.slipId !== c.destinationSlipId).length,
        0,
      ),
    ).toBe(2);
  });

  it("absorbs a missing-timestamp row into the one exact-matching timestamped deposit", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "CaptainSmasher",
        depositAt: "2026-07-11T10:38:00.000Z",
        amount: 6000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "CaptainSmasher",
        depositAt: "2026-07-11T11:07:00.000Z",
        amount: 7000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "CaptainSmasher",
        depositAt: null,
        amount: 6000,
        termDays: 1,
        status: "locked",
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(
      report.clusters.some((c) => c.reason === "redundant_missing_timestamp"),
    ).toBe(true);
    expect(
      report.clusters.some(
        (c) => c.reason === "commander_match_missing_timestamp_ambiguous",
      ),
    ).toBe(false);
  });

  it("flags missing-timestamp rows when two same-identity timestamped deposits make the match ambiguous", () => {
    const { report } = dedupeDepositSlips([
      slip({
        commanderName: "Ambiguous Twin",
        depositAt: "2026-07-11T10:38:00.000Z",
        amount: 6000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "Ambiguous Twin",
        depositAt: "2026-07-11T11:07:00.000Z",
        amount: 6000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "Ambiguous Twin",
        depositAt: null,
        amount: 6000,
        termDays: 1,
        status: "locked",
      }),
    ]);

    expect(
      report.clusters.some(
        (c) => c.reason === "commander_match_missing_timestamp_ambiguous",
      ),
    ).toBe(true);
  });

  it("does not lifecycle-merge two matured deposits that only share display fields", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Twin Matured",
        depositAt: "2026-07-10T12:00:00.000Z",
        amount: 4000,
        termDays: 1,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 4560,
      }),
      slip({
        commanderName: "Twin Matured",
        depositAt: "2026-07-11T12:00:00.000Z",
        amount: 4000,
        termDays: 1,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 4560,
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(
      report.clusters.some((c) =>
        c.reason.startsWith("lifecycle_locked_to_"),
      ),
    ).toBe(false);
  });

  it("does not fold two locked initiates into one matured outcome", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Double Lock",
        depositAt: "2026-07-10T12:00:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "Double Lock",
        depositAt: "2026-07-10T18:00:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "Double Lock",
        depositAt: "2026-07-11T14:30:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 5700,
      }),
    ]);

    expect(slips).toHaveLength(3);
    expect(
      report.clusters.some((c) => c.reason === "lifecycle_locked_to_matured"),
    ).toBe(false);
  });

  it("does not lifecycle-merge locked + matured hours apart (not term-aligned)", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Early Green",
        depositAt: "2026-07-10T12:00:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "locked",
      }),
      slip({
        commanderName: "Early Green",
        depositAt: "2026-07-10T14:00:00.000Z",
        amount: 5000,
        termDays: 1,
        status: "matured",
        outcomeKind: "total_return",
        outcomeAmount: 5700,
      }),
    ]);

    expect(slips).toHaveLength(2);
    expect(
      report.clusters.some((c) => c.reason === "lifecycle_locked_to_matured"),
    ).toBe(false);
  });

  it("peels a ≤15m post-loot re-deposit locked out of proximity merge", () => {
    // Initiate 12:00 → loot 12:10 → re-deposit 12:20 all fit the 15m diameter.
    // Peel keeps the post-terminal locked from riding the initiate+loot merge.
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Loot Redeposit",
        depositAt: "2026-07-10T12:00:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "locked",
      }),
      slip({
        commanderName: "Loot Redeposit",
        depositAt: "2026-07-10T12:10:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 0,
      }),
      slip({
        commanderName: "Loot Redeposit",
        depositAt: "2026-07-10T12:20:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "locked",
      }),
    ]);

    expect(slips).toHaveLength(2);
    const lockedRedeposit = slips.find(
      (s) =>
        s.status === "locked" &&
        s.depositAt === "2026-07-10T12:20:00.000Z",
    );
    expect(lockedRedeposit).toBeDefined();
    expect(lockedRedeposit?.amount).toBe(5000);
    expect(slips.some((s) => s.status === "looted")).toBe(true);
    expect(
      report.clusters.filter((c) => c.reason === "lifecycle_locked_to_looted"),
    ).toHaveLength(0);
  });

  it("still merges multi-frame OCR duplicates of a peeled post-loot re-deposit", () => {
    // Two frames of the same post-loot locked must coalesce after peel, not
    // stay as separate singleton survivors.
    const { slips } = dedupeDepositSlips([
      slip({
        commanderName: "Loot Redeposit Dup",
        depositAt: "2026-07-10T12:00:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "locked",
      }),
      slip({
        commanderName: "Loot Redeposit Dup",
        depositAt: "2026-07-10T12:10:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 0,
      }),
      slip({
        commanderName: "Loot Redeposit Dup",
        depositAt: "2026-07-10T12:20:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "locked",
        sourceFrameIndex: 10,
      }),
      slip({
        commanderName: "Loot Redeposit Dup",
        depositAt: "2026-07-10T12:20:05.000Z",
        amount: 5000,
        termDays: 3,
        status: "locked",
        sourceFrameIndex: 11,
      }),
    ]);

    expect(slips).toHaveLength(2);
    const lockedRedeposits = slips.filter((s) => s.status === "locked");
    expect(lockedRedeposits).toHaveLength(1);
    expect(lockedRedeposits[0]?.depositAt).toMatch(/^2026-07-10T12:20/);
  });

  it("does not absorb a post-loot re-deposit blue into a multi-frame-OCR'd orange majority (majority-outlier status guard)", () => {
    // Three OCR reads of the SAME orange (looted) row within one minute form
    // a majority home; a single re-deposit blue row lands ~20m later — inside
    // the 45m outlier window, but status-mismatched, so must stay separate.
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Post Loot Redeposit",
        depositAt: "2026-07-10T12:00:09.000Z",
        amount: 5000,
        termDays: 3,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 0,
        sourceFrameIndex: 9,
      }),
      slip({
        commanderName: "Post Loot Redeposit",
        depositAt: "2026-07-10T12:00:10.000Z",
        amount: 5000,
        termDays: 3,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 0,
        sourceFrameIndex: 10,
      }),
      slip({
        commanderName: "Post Loot Redeposit",
        depositAt: "2026-07-10T12:00:12.000Z",
        amount: 5000,
        termDays: 3,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 0,
        sourceFrameIndex: 11,
      }),
      slip({
        commanderName: "Post Loot Redeposit",
        depositAt: "2026-07-10T12:20:00.000Z",
        amount: 5000,
        termDays: 3,
        status: "locked",
        sourceFrameIndex: 40,
      }),
    ]);

    const lockedRedeposit = slips.find(
      (s) =>
        s.status === "locked" && s.depositAt === "2026-07-10T12:20:00.000Z",
    );
    expect(lockedRedeposit).toBeDefined();
    // No survivor may claim an outcome before its own deposit (the corruption
    // this guard prevents: the re-deposit's later depositAt paired with the
    // earlier orange's outcomeAt).
    for (const s of slips) {
      if (s.outcomeAt && s.depositAt) {
        expect(Date.parse(s.outcomeAt)).toBeGreaterThanOrEqual(
          Date.parse(s.depositAt),
        );
      }
    }
    expect(
      report.clusters.some((c) => c.reason === "lifecycle_locked_to_looted"),
    ).toBe(false);
  });
});

describe("dedupeDepositSlips — slipId uniqueness", () => {
  it("is semantically idempotent when run again on already-deduped output", () => {
    const input = [
      slip({ commanderName: "Repeatable", amount: 6000 }),
      slip({ commanderName: "Repeatable", amount: 6000 }),
      slip({
        commanderName: "Independent",
        depositAt: "2026-07-11T10:01:00.000Z",
      }),
    ];
    const first = dedupeDepositSlips(input);
    const second = dedupeDepositSlips(first.slips);
    const withoutRuntimeIds = (rows: typeof first.slips) =>
      rows.map((row) => {
        const copy: Partial<(typeof rows)[number]> = { ...row };
        delete copy.slipId;
        delete copy.dedupeClusterId;
        return copy;
      });

    expect(withoutRuntimeIds(second.slips)).toEqual(withoutRuntimeIds(first.slips));
    expect(second.report.autoMergedCount).toBe(0);
    expect(second.report.clusters).toHaveLength(0);
  });

  it("assigns unique slipIds across independent dedupe calls (serverless-safe)", () => {
    const input = [
      slip({ commanderName: "Bravo", depositAt: "2026-07-11T10:00:00.000Z" }),
    ];
    const { slips: slips1 } = dedupeDepositSlips(input);
    const { slips: slips2 } = dedupeDepositSlips(input);

    const id1 = slips1[0]?.slipId;
    const id2 = slips2[0]?.slipId;
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it("persists all output slipIds as unique strings (no counter collisions)", () => {
    const inputs = Array.from({ length: 5 }, (_, i) =>
      slip({ commanderName: `Solo${i}`, depositAt: `2026-07-11T10:0${i}:00.000Z` }),
    );
    const { slips } = dedupeDepositSlips(inputs);
    const ids = slips.map((s) => s.slipId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("prefers the higher-confidence duplicate when completeness is equal", () => {
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "ConfidencePick",
        depositAt: "2026-07-11T13:18:26.000Z",
        confidence: 55,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "ConfidencePick",
          rawIdentity: "#1203[LFgo]ConfidencePick",
        },
      }),
      slip({
        commanderName: "ConfidencePick",
        depositAt: "2026-07-11T13:18:40.000Z",
        confidence: 92,
        identity: {
          gameServerNumber: 1203,
          allianceTag: "LFgo",
          commanderName: "ConfidencePick",
          rawIdentity: "#1203[LFgo]ConfidencePick",
        },
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.confidence).toBe(92);
    expect(report.autoMergedCount).toBe(1);
  });

  it("merges Hercules28 locked + looted same minute via lifecycle (not flagged conflict)", () => {
    const depositAt = "2026-07-11T13:18:40.000Z";
    const { slips, report } = dedupeDepositSlips([
      slip({
        commanderName: "Hercules28",
        depositAt,
        amount: 6000,
        termDays: 3,
        status: "locked",
      }),
      slip({
        commanderName: "Hercules28",
        depositAt,
        amount: 6000,
        termDays: 1,
        status: "looted",
        outcomeKind: "early_termination_refund",
        outcomeAmount: 5970,
      }),
    ]);

    expect(slips).toHaveLength(1);
    expect(slips[0]?.status).toBe("looted");
    expect(report.flaggedCount).toBe(0);
    expect(
      report.clusters.some((c) => c.reason === "lifecycle_locked_to_looted"),
    ).toBe(true);
    expect(
      report.clusters.some(
        (c) => c.reason === "same_commander_timestamp_conflicting_amount_or_term",
      ),
    ).toBe(false);
  });
});
