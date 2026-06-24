import { describe, expect, it } from "vitest";

import {
  gameSeasonCapsChanged,
  parsePatchGameSeasonCapsBody,
} from "@/lib/admin/admin-game-seasons.shared";

describe("parsePatchGameSeasonCapsBody", () => {
  it("accepts maxBaseVr only", () => {
    const result = parsePatchGameSeasonCapsBody({
      seasonId: "season-3",
      maxBaseVr: 12000,
    });
    expect(result).toEqual({
      ok: true,
      data: { seasonId: "season-3", maxBaseVr: 12000 },
    });
  });

  it("accepts maxProfessionLevel only (including null)", () => {
    const result = parsePatchGameSeasonCapsBody({
      seasonId: "season-3",
      maxProfessionLevel: null,
    });
    expect(result).toEqual({
      ok: true,
      data: { seasonId: "season-3", maxProfessionLevel: null },
    });
  });

  it("rejects seasonId without cap fields", () => {
    const result = parsePatchGameSeasonCapsBody({ seasonId: "season-3" });
    expect(result).toEqual({
      ok: false,
      error: "At least one of maxBaseVr or maxProfessionLevel is required",
    });
  });

  it("rejects invalid maxBaseVr", () => {
    const result = parsePatchGameSeasonCapsBody({
      seasonId: "season-3",
      maxBaseVr: 100,
    });
    expect(result.ok).toBe(false);
  });
});

describe("gameSeasonCapsChanged", () => {
  it("detects cap changes", () => {
    expect(
      gameSeasonCapsChanged(
        { maxBaseVr: 10000, maxProfessionLevel: 5 },
        { maxBaseVr: 11000, maxProfessionLevel: 5 },
      ),
    ).toBe(true);
    expect(
      gameSeasonCapsChanged(
        { maxBaseVr: 10000, maxProfessionLevel: 5 },
        { maxBaseVr: 10000, maxProfessionLevel: null },
      ),
    ).toBe(true);
  });

  it("returns false when caps unchanged", () => {
    expect(
      gameSeasonCapsChanged(
        { maxBaseVr: 10000, maxProfessionLevel: 5 },
        { maxBaseVr: 10000, maxProfessionLevel: 5 },
      ),
    ).toBe(false);
  });
});
