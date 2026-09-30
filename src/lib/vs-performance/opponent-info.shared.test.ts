import { describe, expect, it } from "vitest";

import {
  ashedWireVsScore,
  buildAshedOpponentCreate,
  buildAshedOpponentUpdate,
  normalizeAshedVsScore,
  normalizeAshedVsTimestamp,
  parseAshedOpponentRow,
  reconcileVsOpponentSnapshot,
  type AshedOpponentSnapshot,
  type VsOpponentInfo,
} from "./opponent-info.shared";
import { VsPerformanceError } from "./weekly-plan.shared";

const FIXTURE = {
  id: "meta-1",
  alliance_id: "ashed-a",
  competition_date: "2026-09-28",
  week_type: "normal",
  opponent_server: 1236,
  opponent_tag: "FOE",
  opponent_name: "Opponent",
  opponent_daily_scores: [1, 2, 3, 4, 5, 6, 0],
  outcome: "loss",
  updated_date: "2026-09-28T06:33:16.296000",
  notes: "preserve",
  daily_types: ["normal", "normal", "normal", "normal", "normal", "normal"],
};

function info(partial: Partial<VsOpponentInfo> = {}): VsOpponentInfo {
  return {
    opponentServer: 1236,
    opponentTag: "FOE",
    opponentName: "Opponent",
    opponentDailyScores: ["1", "2", "3", "4", "5", "6"],
    weekOutcome: "loss",
    ...partial,
  };
}

function snapshot(partial: Partial<AshedOpponentSnapshot> = {}): AshedOpponentSnapshot {
  return {
    remoteId: "meta-1",
    allianceId: "ashed-a",
    weekStart: "2026-09-28",
    compatibilityScore: "0",
    sourceRevision: "2026-09-28T06:33:16.296000000Z",
    ...info(),
    ...partial,
  };
}

describe("parseAshedOpponentRow", () => {
  it("parses the authorized fixture into six scores plus a tail slot", () => {
    const parsed = parseAshedOpponentRow(FIXTURE, "ashed-a");
    expect(parsed.opponentDailyScores).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(parsed.compatibilityScore).toBe("0");
    expect(parsed.weekOutcome).toBe("loss");
    expect(parsed.opponentServer).toBe(1236);
    expect(parsed.sourceRevision).toBe("2026-09-28T06:33:16.296000000Z");
    expect(parsed.remoteId).toBe("meta-1");
  });

  it("tolerates a null daily score array and null entries", () => {
    const parsed = parseAshedOpponentRow(
      { ...FIXTURE, opponent_daily_scores: null },
      "ashed-a",
    );
    expect(parsed.opponentDailyScores).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    const partial = parseAshedOpponentRow(
      { ...FIXTURE, opponent_daily_scores: [1, null, 0, 4, 5, 6, 0] },
      "ashed-a",
    );
    expect(partial.opponentDailyScores).toEqual([
      "1",
      null,
      "0",
      "4",
      "5",
      "6",
    ]);
  });

  it("rejects wrong alliance, malformed weeks, and bad score values", () => {
    expect(() => parseAshedOpponentRow(FIXTURE, "other")).toThrow(
      VsPerformanceError,
    );
    for (const bad of [
      { ...FIXTURE, competition_date: "2026-09-29" },
      { ...FIXTURE, competition_date: "2099-01-01" },
      { ...FIXTURE, opponent_daily_scores: [1, 2, 3, 4, 5] },
      { ...FIXTURE, opponent_daily_scores: [1, 2, 3, 4, 5, 6, 7, 8] },
      { ...FIXTURE, opponent_daily_scores: [1, -2, 3, 4, 5, 6, 0] },
      { ...FIXTURE, opponent_daily_scores: [1, 9007199254740993, 3, 4, 5, 6, 0] },
      { ...FIXTURE, opponent_daily_scores: [1, 1.5, 3, 4, 5, 6, 0] },
    ]) {
      expect(() => parseAshedOpponentRow(bad, "ashed-a")).toThrow();
    }
  });
});

describe("normalizeAshedVsTimestamp", () => {
  it("normalizes naive and fractional timestamps to canonical UTC", () => {
    expect(normalizeAshedVsTimestamp("2026-09-28T06:33:16.296")).toBe(
      "2026-09-28T06:33:16.296000000Z",
    );
    expect(normalizeAshedVsTimestamp("2026-09-28T06:33:16Z")).toBe(
      "2026-09-28T06:33:16.000000000Z",
    );
    expect(normalizeAshedVsTimestamp("2026-09-28T06:33:16.296000Z")).toBe(
      "2026-09-28T06:33:16.296000000Z",
    );
  });

  it("rejects non-strings and invalid values", () => {
    for (const value of [null, 42, "not a time", "2026-13-01T00:00:00"]) {
      expect(() => normalizeAshedVsTimestamp(value)).toThrow();
    }
  });
});

describe("normalizeAshedVsScore", () => {
  it("keeps exact decimal strings and safe numbers", () => {
    expect(normalizeAshedVsScore(6)).toBe("6");
    expect(normalizeAshedVsScore(0)).toBe("0");
    expect(normalizeAshedVsScore(null)).toBeNull();
    expect(normalizeAshedVsScore("9007199254740993")).toBe("9007199254740993");
    expect(() => normalizeAshedVsScore(9007199254740993)).toThrow();
    expect(() => normalizeAshedVsScore(-1)).toThrow();
    expect(() => normalizeAshedVsScore(1.5)).toThrow();
  });
});

describe("ashedWireVsScore", () => {
  it("rejects scores above MAX_SAFE_INTEGER instead of rounding", () => {
    expect(ashedWireVsScore("42")).toBe(42);
    expect(ashedWireVsScore(null)).toBeNull();
    expect(() => ashedWireVsScore("9007199254740993")).toThrow(
      expect.objectContaining({ code: "score_too_large" }),
    );
  });
});

describe("buildAshedOpponentCreate", () => {
  it("emits only the verified create keys with a zero compatibility slot", () => {
    const body = buildAshedOpponentCreate("ashed-a", "2026-09-28", info());
    expect(body).toEqual({
      alliance_id: "ashed-a",
      competition_date: "2026-09-28",
      week_type: "normal",
      opponent_server: 1236,
      opponent_tag: "FOE",
      opponent_name: "Opponent",
      opponent_daily_scores: [1, 2, 3, 4, 5, 6, 0],
      outcome: "loss",
    });
  });
});

describe("buildAshedOpponentUpdate", () => {
  it("patches a single day while preserving remote days and the tail slot", () => {
    const { patch, conflicts } = buildAshedOpponentUpdate({
      current: snapshot(),
      baseline: snapshot(),
      desired: info({
        opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
      }),
      dirtyFields: ["day:2"],
    });
    expect(conflicts).toEqual([]);
    expect(patch).toEqual({
      opponent_daily_scores: [1, 99, 3, 4, 5, 6, 0],
    });
    expect(patch).not.toHaveProperty("notes");
    expect(patch).not.toHaveProperty("week_type");
    expect(patch).not.toHaveProperty("daily_types");
  });

  it("flags a conflict when the remote changed a dirty field off baseline", () => {
    const remote = snapshot({
      opponentDailyScores: ["1", "77", "3", "4", "5", "6"],
    });
    const { patch, conflicts } = buildAshedOpponentUpdate({
      current: remote,
      baseline: snapshot(),
      desired: info({
        opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
      }),
      dirtyFields: ["day:2", "day:3"],
    });
    expect(conflicts).toEqual(["day:2"]);
    expect(patch).toEqual({});
  });

  it("leaves untouched remote days alone on a partial dirty push", () => {
    const remote = snapshot({
      opponentDailyScores: ["1", "2", "30", "4", "5", "6"],
    });
    const { patch, conflicts } = buildAshedOpponentUpdate({
      current: remote,
      baseline: snapshot(),
      desired: info({
        opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
      }),
      dirtyFields: ["day:2"],
    });
    expect(conflicts).toEqual([]);
    expect(patch).toEqual({
      opponent_daily_scores: [1, 99, 30, 4, 5, 6, 0],
    });
  });

  it("rejects an unsafe score on the wire", () => {
    expect(() =>
      buildAshedOpponentUpdate({
        current: snapshot(),
        baseline: snapshot(),
        desired: info({
          opponentDailyScores: ["9007199254740993", "2", "3", "4", "5", "6"],
        }),
        dirtyFields: ["day:1"],
      }),
    ).toThrow(expect.objectContaining({ code: "score_too_large" }));
  });
});

describe("reconcileVsOpponentSnapshot", () => {
  it("keeps conflict only on the unacknowledged dirty day and preserves its baseline", () => {
    const remote = snapshot({
      opponentDailyScores: ["1", "99", "33", "4", "5", "6"],
    });
    const local = info({
      opponentDailyScores: ["1", "100", "44", "4", "5", "6"],
    });
    for (const unresolved of [[], ["day:3"]] as const) {
      const result = reconcileVsOpponentSnapshot({
        local,
        remote,
        baseline: snapshot(),
        owned: ["day:2", "day:3"],
        dirty: ["day:2", "day:3"],
        unresolved,
        acknowledged: ["day:2"],
      });
      expect(result.conflicts).toEqual(["day:3"]);
      expect(result.local.opponentDailyScores).toEqual([
        "1",
        "100",
        "44",
        "4",
        "5",
        "6",
      ]);
      expect(result.baseline.opponentDailyScores).toEqual([
        "1",
        "99",
        "3",
        "4",
        "5",
        "6",
      ]);
    }
  });

  it("conflicts a dirty day without a baseline and never turns the remote value into consent", () => {
    const remote = snapshot({
      opponentDailyScores: ["1", "2", "3", "4", "5", "6"],
    });
    const local = info({
      opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
    });
    const first = reconcileVsOpponentSnapshot({
      local,
      remote,
      baseline: null,
      owned: ["day:2"],
      dirty: ["day:2"],
      unresolved: [],
    });
    expect(first.conflicts).toEqual(["day:2"]);
    const second = reconcileVsOpponentSnapshot({
      local,
      remote,
      baseline: remote,
      owned: ["day:2"],
      dirty: ["day:2"],
      unresolved: ["day:2"],
    });
    expect(second.conflicts).toEqual(["day:2"]);
    expect(second.baseline.opponentDailyScores[1]).toBe("2");
  });

  it("follows the remote on unowned fields but always conflicts an owned non-dirty mismatch", () => {
    const remote = snapshot({
      opponentDailyScores: ["1", "2", "30", "4", "5", "6"],
    });
    const local = info({
      opponentDailyScores: ["1", "99", "3", "4", "5", "6"],
    });
    const result = reconcileVsOpponentSnapshot({
      local,
      remote,
      baseline: snapshot(),
      owned: ["day:2"],
      dirty: [],
      unresolved: [],
    });
    expect(result.local.opponentDailyScores).toEqual([
      "1",
      "99",
      "30",
      "4",
      "5",
      "6",
    ]);
    expect(result.conflicts).toEqual(["day:2"]);

    const matching = reconcileVsOpponentSnapshot({
      local: info(),
      remote: snapshot(),
      baseline: snapshot(),
      owned: ["day:2"],
      dirty: [],
      unresolved: [],
    });
    expect(matching.conflicts).toEqual([]);
    expect(matching.local).toEqual(info());
  });
});
