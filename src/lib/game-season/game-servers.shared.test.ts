import { describe, expect, it } from "vitest";

import {
  gameSeasonIdForNumber,
  gameServerIdForNumber,
} from "@/lib/game-season/game-servers.shared";

describe("game server / season ids", () => {
  it("builds deterministic ids", () => {
    expect(gameSeasonIdForNumber(42)).toBe("season-42");
    expect(gameServerIdForNumber(1203)).toBe("server-1203");
  });
});
