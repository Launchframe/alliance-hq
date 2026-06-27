import { describe, expect, it } from "vitest";

import {
  MAIN_SQUAD_TYPES,
  parseMainSquadType,
  mainSquadSortOrder,
} from "@/lib/commanders/main-squad.shared";

describe("main-squad.shared", () => {
  it("parses valid squad types", () => {
    for (const squad of MAIN_SQUAD_TYPES) {
      expect(parseMainSquadType(squad)).toBe(squad);
    }
  });

  it("rejects invalid squad types", () => {
    expect(parseMainSquadType("infantry")).toBeNull();
    expect(parseMainSquadType(null)).toBeNull();
  });

  it("orders unreported last", () => {
    expect(mainSquadSortOrder(null)).toBeGreaterThan(mainSquadSortOrder("missile"));
  });
});
