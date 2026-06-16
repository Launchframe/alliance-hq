import { describe, expect, it } from "vitest";

import { parseAshedGameServerNumber } from "@/lib/game-season/ashed";
import { resolveEffectiveSeasonFromRow } from "@/lib/game-season/resolve";
import type { AllianceSeasonRow } from "@/lib/game-season/types";

const baseRow: AllianceSeasonRow = {
  id: "a1",
  currentSeasonKey: "3",
  gameServerNumber: 1203,
  gameServerOpenTimestamp: null,
  seasonKeyOverride: null,
  seasonKeySynced: "3",
  seasonKeySource: "cpt-hedge",
  seasonSyncedAt: null,
  seasonIsPostSeason: 0,
  seasonWeek: 2,
};

describe("parseAshedGameServerNumber", () => {
  it("parses float server_number from Ashed", () => {
    expect(parseAshedGameServerNumber({ server_number: 1203.0 })).toBe(1203);
  });

  it("returns null for invalid values", () => {
    expect(parseAshedGameServerNumber({ server_number: 0 })).toBeNull();
    expect(parseAshedGameServerNumber({ server_number: null })).toBeNull();
  });
});

describe("resolveEffectiveSeasonFromRow", () => {
  it("prefers owner override", () => {
    const effective = resolveEffectiveSeasonFromRow({
      ...baseRow,
      seasonKeyOverride: "5",
      seasonKeySynced: "4",
      seasonKeySource: "cpt-hedge",
    });
    expect(effective.seasonKey).toBe("5");
    expect(effective.source).toBe("override");
  });

  it("uses synced season when no override", () => {
    const effective = resolveEffectiveSeasonFromRow(baseRow);
    expect(effective.seasonKey).toBe("3");
    expect(effective.source).toBe("cpt-hedge");
  });
});
