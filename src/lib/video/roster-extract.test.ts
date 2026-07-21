import { describe, expect, it } from "vitest";

import {
  collapseRosterMembersByNameRank,
  extractRosterMembers,
  parsePowerLevelString,
  parseRosterVideoAllianceRank,
  rosterOcrMemberToExtracted,
} from "@/lib/video/roster-extract";

describe("roster-extract", () => {
  it("extracts members from Ashed ExtractData output wrapper", () => {
    const payload = {
      status: "success",
      output: {
        members: [
          {
            current_name: "Alpha",
            rank: "R3",
            power_level: "162.8M",
            level: 30,
          },
        ],
      },
    };

    expect(extractRosterMembers(payload)).toHaveLength(1);
    expect(extractRosterMembers(payload)[0]?.current_name).toBe("Alpha");
  });

  it("extracts members from nested OCR payload", () => {
    const payload = {
      data: {
        members: [
          { current_name: "Alpha", rank: "R3", power_level: "162.8M", level: 30 },
          { current_name: "Beta", rank: "Warlord", level: 35 },
        ],
      },
    };

    expect(extractRosterMembers(payload)).toHaveLength(2);
    expect(extractRosterMembers(payload)[0]?.current_name).toBe("Alpha");
  });

  it("ignores officer title in profession and rank title from OCR", () => {
    const extracted = rosterOcrMemberToExtracted({
      current_name: "Cmoney1985",
      rank: "R5",
      profession: "Warlord",
    });

    expect(extracted.allianceRank).toBe(5);
    expect(extracted.allianceRankTitle).toBeNull();
    expect(extracted.profession).toBeNull();
  });

  it("maps OCR member to alliance rank and power; ignores OCR level and profession", () => {
    const extracted = rosterOcrMemberToExtracted({
      current_name: "Alpha",
      rank: "R4",
      power_level: "162.8M",
      level: 30,
      profession: "Engineer",
    });

    expect(extracted.allianceRank).toBe(4);
    expect(extracted.rosterRankRaw).toBe("R4");
    expect(extracted.powerLevel).toBe("162.8M");
    expect(extracted.heroPowerM).toBe(162.8);
    expect(extracted.memberLevel).toBeNull();
    expect(extracted.profession).toBeNull();
  });

  it("treats junk rank strings as null", () => {
    expect(parseRosterVideoAllianceRank("null")).toEqual({
      allianceRank: null,
      rosterRankRaw: null,
    });
    expect(parseRosterVideoAllianceRank("undefined")).toEqual({
      allianceRank: null,
      rosterRankRaw: null,
    });
    expect(parseRosterVideoAllianceRank("N/A")).toEqual({
      allianceRank: null,
      rosterRankRaw: null,
    });
  });

  it("maps bare officer title rank to R4 without storing title", () => {
    const extracted = rosterOcrMemberToExtracted({
      current_name: "Officer",
      rank: "Warlord",
    });
    expect(extracted.allianceRank).toBe(4);
    expect(extracted.allianceRankTitle).toBeNull();
  });

  it("normalizes level 0 to null", () => {
    const extracted = rosterOcrMemberToExtracted({
      current_name: "Header",
      rank: "R5",
      level: 0,
    });
    expect(extracted.memberLevel).toBeNull();
  });

  it("parses power level strings with suffixes, raw integers, and rejects junk", () => {
    expect(parsePowerLevelString("162.8M")).toEqual({
      powerLevel: "162.8M",
      heroPowerM: 162.8,
    });
    expect(parsePowerLevelString("1.2B")).toEqual({
      powerLevel: "1200M",
      heroPowerM: 1200,
    });
    expect(parsePowerLevelString("950.3K")).toEqual({
      powerLevel: "0.95M",
      heroPowerM: 0.9503,
    });
    expect(parsePowerLevelString("297494218")).toEqual({
      powerLevel: "297.5M",
      heroPowerM: 297.494218,
    });
    expect(parsePowerLevelString("297.5")).toEqual({
      powerLevel: "297.5M",
      heroPowerM: 297.5,
    });
    expect(parsePowerLevelString("500000")).toEqual({
      powerLevel: null,
      heroPowerM: null,
    });
    expect(parsePowerLevelString("")).toEqual({
      powerLevel: null,
      heroPowerM: null,
    });
    expect(parsePowerLevelString("null")).toEqual({
      powerLevel: null,
      heroPowerM: null,
    });
    expect(parsePowerLevelString("N/A")).toEqual({
      powerLevel: null,
      heroPowerM: null,
    });
    expect(parsePowerLevelString("Member")).toEqual({
      powerLevel: null,
      heroPowerM: null,
    });
  });

  it("dedupes roster rows by name only, preferring richer rows", () => {
    const rows = [
      rosterOcrMemberToExtracted({ current_name: "Alpha", rank: "R3" }),
      rosterOcrMemberToExtracted({
        current_name: "Alpha",
        rank: "R5",
        power_level: "100M",
        level: 25,
      }),
    ];

    const collapsed = collapseRosterMembersByNameRank(rows);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.powerLevel).toBe("100M");
    expect(collapsed[0]?.memberLevel).toBeNull();
    expect(collapsed[0]?.allianceRank).toBe(5);
  });

  it("collapses duplicate names across frames with different ranks", () => {
    const rows = [
      rosterOcrMemberToExtracted({
        current_name: "Cmoney1985",
        rank: "null",
        profession: "Warlord",
      }),
      rosterOcrMemberToExtracted({
        current_name: "Cmoney1985",
        rank: "R5",
        power_level: "181.3M",
        level: 33,
      }),
    ];

    const collapsed = collapseRosterMembersByNameRank(rows);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.heroPowerM).toBe(181.3);
    expect(collapsed[0]?.allianceRankTitle).toBeNull();
  });
});
