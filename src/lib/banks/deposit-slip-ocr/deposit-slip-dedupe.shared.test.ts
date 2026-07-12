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
    depositAt: partial.depositAt ?? "2026-07-11T13:18:26.000Z",
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

  it("flags timestamp collisions across different commanders", () => {
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
    expect(report.flaggedCount).toBe(1);
    expect(report.clusters[0]?.reason).toBe(
      "timestamp_collision_different_commanders",
    );
    expect(slips.every((s) => s.dedupeClusterId)).toBe(true);
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
