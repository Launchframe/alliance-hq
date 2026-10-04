import { describe, expect, it } from "vitest";

import {
  compareEventResults,
  EVENT_FAMILY_POLICY,
  EVENT_LEGACY_LEADERBOARD_CREDIT,
  EVENT_POLL_NO_CREDIT,
  EVENT_POLL_YES_CREDIT,
  EVENT_POLICY_VERSION,
  EVENT_PROVENANCE_KINDS,
  EVENT_EVIDENCE_KINDS,
  EVENT_TARGETS,
  eventRealScoreQualifies,
} from "@/lib/hq-events/event-types.shared";

describe("event family policy", () => {
  it("exposes one policy per supported target", () => {
    expect(Object.keys(EVENT_FAMILY_POLICY).sort()).toEqual(
      [...EVENT_TARGETS].sort(),
    );
    for (const policy of Object.values(EVENT_FAMILY_POLICY)) {
      expect(typeof policy.realScoreMinimumExclusive).toBe("string");
      expect(BigInt(policy.realScoreMinimumExclusive) >= BigInt(0)).toBe(true);
    }
    expect(EVENT_POLICY_VERSION).toBe(1);
  });

  it("keeps Warzone search aliases", () => {
    const aliases = EVENT_FAMILY_POLICY["warzone-duel"].searchAliases;
    for (const alias of ["capitol war", "capital war", "svs"]) {
      expect(aliases).toContain(alias);
    }
    expect(EVENT_FAMILY_POLICY["warzone-duel"].pollEvidence).toBe(true);
    expect(EVENT_FAMILY_POLICY["desert-storm"].teamScoped).toBe(true);
    expect(EVENT_FAMILY_POLICY["canyon-storm"].teamScoped).toBe(true);
  });

  it("documents evidence kinds and provenance", () => {
    expect(EVENT_EVIDENCE_KINDS).toEqual([
      "leaderboard",
      "poll_yes",
      "poll_no",
      "legacy_leaderboard",
    ]);
    expect(EVENT_PROVENANCE_KINDS).toEqual([
      "video",
      "image",
      "manual",
      "ashed",
      "legacy",
    ]);
  });

  it("keeps poll credits as projection-only canonical strings", () => {
    expect(EVENT_POLL_YES_CREDIT).toBe("1000");
    expect(EVENT_POLL_NO_CREDIT).toBe("1");
    expect(EVENT_LEGACY_LEADERBOARD_CREDIT).toBe("2000");
  });
});

describe("eventRealScoreQualifies", () => {
  const tuple = (score: string, stage: number | null = null) => ({
    score,
    stage,
  });

  it("applies the Warzone >1 boundary", () => {
    expect(eventRealScoreQualifies("warzone-duel", tuple("0"))).toBe(false);
    expect(eventRealScoreQualifies("warzone-duel", tuple("1"))).toBe(false);
    expect(eventRealScoreQualifies("warzone-duel", tuple("2"))).toBe(true);
  });

  it("applies the >0 boundary to seasonal and storm boards", () => {
    for (const target of [
      "seasonal",
      "desert-storm",
      "canyon-storm",
    ] as const) {
      expect(eventRealScoreQualifies(target, tuple("0"))).toBe(false);
      expect(eventRealScoreQualifies(target, tuple("1"))).toBe(true);
    }
  });

  it("requires a stage and a positive score for Frontline", () => {
    expect(
      eventRealScoreQualifies("frontline-breakthrough", tuple("500", null)),
    ).toBe(false);
    expect(
      eventRealScoreQualifies("frontline-breakthrough", tuple("0", 3)),
    ).toBe(false);
    expect(
      eventRealScoreQualifies("frontline-breakthrough", tuple("1", 3)),
    ).toBe(true);
  });
});

describe("compareEventResults", () => {
  it("orders descending by score as BigInt beyond MAX_SAFE_INTEGER", () => {
    const huge = `${BigInt(2) ** BigInt(62)}`;
    const bigger = `${BigInt(2) ** BigInt(62) + BigInt(5)}`;
    // Number() would collapse these; the comparator must not.
    expect(Number(huge)).toBe(Number(bigger));
    expect(
      compareEventResults(
        "warzone-duel",
        { score: bigger, stage: null },
        { score: huge, stage: null },
      ),
    ).toBeLessThan(0);
    expect(
      compareEventResults(
        "warzone-duel",
        { score: huge, stage: null },
        { score: bigger, stage: null },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareEventResults(
        "warzone-duel",
        { score: bigger, stage: null },
        { score: bigger, stage: null },
      ),
    ).toBe(0);
  });

  it("orders Frontline stage first, then score", () => {
    const highStageLowScore = { score: "100", stage: 5 };
    const lowStageHighScore = { score: "999999999", stage: 4 };
    expect(
      compareEventResults(
        "frontline-breakthrough",
        highStageLowScore,
        lowStageHighScore,
      ),
    ).toBeLessThan(0);
    expect(
      compareEventResults(
        "frontline-breakthrough",
        { score: "50", stage: 5 },
        { score: "10", stage: 5 },
      ),
    ).toBeLessThan(0);
  });
});
