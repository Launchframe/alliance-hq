import { beforeEach, describe, expect, it } from "vitest";

import {
  coalesceDepositSlips,
  dedupeDepositSlips,
  resetDepositSlipIdCounterForTests,
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
    identity: {
      gameServerNumber: partial.identity?.gameServerNumber ?? 1203,
      allianceTag: partial.identity?.allianceTag ?? "LFgo",
      commanderName: partial.commanderName,
      rawIdentity:
        partial.identity?.rawIdentity ??
        `#1203[LFgo]${partial.commanderName}`,
    },
    sourceFrameIndex: partial.sourceFrameIndex,
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
      report.clusters.some((c) => c.reason === "commander_match_missing_timestamp"),
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

  it("flags a timestamp-less row as ambiguous when it conflicts with its best name match", () => {
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
    expect(
      report.clusters.some((c) => c.reason === "commander_match_missing_timestamp"),
    ).toBe(true);
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
});
