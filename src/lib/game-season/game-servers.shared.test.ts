import { describe, expect, it } from "vitest";

import {
  allianceReceivesServerSeasonMirror,
  DEFAULT_MAX_BASE_VR,
  gameSeasonIdForNumber,
  gameServerIdForNumber,
} from "@/lib/game-season/game-servers.shared";

describe("game server / season ids", () => {
  it("builds deterministic ids", () => {
    expect(gameSeasonIdForNumber(42)).toBe("season-42");
    expect(gameServerIdForNumber(1203)).toBe("server-1203");
  });
});

describe("DEFAULT_MAX_BASE_VR", () => {
  it("defaults to 10000", () => {
    expect(DEFAULT_MAX_BASE_VR).toBe(10000);
  });
});

describe("allianceReceivesServerSeasonMirror", () => {
  it("allows mirror when override is unset", () => {
    expect(allianceReceivesServerSeasonMirror(null)).toBe(true);
    expect(allianceReceivesServerSeasonMirror("")).toBe(true);
    expect(allianceReceivesServerSeasonMirror("   ")).toBe(true);
  });

  it("blocks mirror when owner override is set", () => {
    expect(allianceReceivesServerSeasonMirror("5")).toBe(false);
  });
});
