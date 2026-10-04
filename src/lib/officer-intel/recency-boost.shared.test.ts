import { describe, expect, it } from "vitest";

import {
  officerIntelRecencyBoost,
  officerIntelScoreWithRecency,
} from "@/lib/officer-intel/recency-boost.shared";

describe("officerIntelRecencyBoost", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");

  it("returns zero when approvedAt is missing", () => {
    expect(officerIntelRecencyBoost(null, now)).toBe(0);
  });

  it("boosts newer notes slightly more than older notes", () => {
    const recent = officerIntelRecencyBoost(
      new Date("2026-07-20T12:00:00.000Z"),
      now,
    );
    const older = officerIntelRecencyBoost(
      new Date("2026-01-01T12:00:00.000Z"),
      now,
    );
    expect(recent).toBeGreaterThan(older);
    expect(recent).toBeLessThanOrEqual(0.05);
  });
});

describe("officerIntelScoreWithRecency", () => {
  it("adds recency boost without dominating base similarity", () => {
    const base = 0.82;
    const boosted = officerIntelScoreWithRecency(
      base,
      new Date("2026-07-24T12:00:00.000Z"),
      new Date("2026-07-25T12:00:00.000Z"),
    );
    expect(boosted).toBeGreaterThan(base);
    expect(boosted - base).toBeLessThanOrEqual(0.05);
  });
});
