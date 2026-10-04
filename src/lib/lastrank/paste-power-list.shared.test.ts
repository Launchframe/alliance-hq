import { describe, expect, it } from "vitest";

import type { LastRankAllianceMember } from "@/lib/lastrank/alliance-page.shared";
import {
  extractNameFromPowerPasteLine,
  formatPasteProfileLinksMarkdown,
  matchPasteNamesToLastRankMembers,
  pasteNamesFromPowerList,
} from "@/lib/lastrank/paste-power-list.shared";

function member(
  partial: Pick<LastRankAllianceMember, "publicId" | "name"> &
    Partial<LastRankAllianceMember>,
): LastRankAllianceMember {
  return {
    country: null,
    power: null,
    heroPower: null,
    allianceRank: null,
    baseLevel: null,
    originServerId: null,
    ...partial,
  };
}

describe("extractNameFromPowerPasteLine", () => {
  it("strips spaced power and parenthetical notes", () => {
    expect(
      extractNameFromPowerPasteLine("Airbytkd - 142M (Has T11 troops)"),
    ).toBe("Airbytkd");
  });

  it("strips spaced power without notes", () => {
    expect(extractNameFromPowerPasteLine("splitxserenade - 146M")).toBe(
      "splitxserenade",
    );
  });

  it("strips trailing period after power", () => {
    expect(extractNameFromPowerPasteLine("Lordisackington - 105M.")).toBe(
      "Lordisackington",
    );
  });

  it("keeps emoji in names", () => {
    expect(extractNameFromPowerPasteLine("Myster⚔️Zero - 175m")).toBe(
      "Myster⚔️Zero",
    );
  });

  it("strips decimal power", () => {
    expect(extractNameFromPowerPasteLine("KelllTownnn - 155.5M")).toBe(
      "KelllTownnn",
    );
  });

  it("handles missing space before hyphen", () => {
    expect(extractNameFromPowerPasteLine("Roger Garcia- 171M.")).toBe(
      "Roger Garcia",
    );
  });

  it("handles glued name-power with no spaces", () => {
    expect(extractNameFromPowerPasteLine("Akatsuki-164m")).toBe("Akatsuki");
  });

  it("returns null for blank lines", () => {
    expect(extractNameFromPowerPasteLine("   ")).toBeNull();
  });

  it("keeps plain names without a power tail", () => {
    expect(extractNameFromPowerPasteLine("capt Grim")).toBe("capt Grim");
  });
});

describe("pasteNamesFromPowerList", () => {
  it("parses a multi-line officer paste", () => {
    const text = `
Airbytkd - 142M (Has T11 troops)
splitxserenade - 146M
EmmaEllaDad - 172M

Akatsuki-164m
`.trim();
    expect(pasteNamesFromPowerList(text)).toEqual([
      "Airbytkd",
      "splitxserenade",
      "EmmaEllaDad",
      "Akatsuki",
    ]);
  });
});

describe("matchPasteNamesToLastRankMembers", () => {
  const roster = [
    member({ publicId: 1, name: "Airbytkd" }),
    member({ publicId: 2, name: "RC81" }),
    member({ publicId: 3, name: "Myster⚔️Zero" }),
    member({ publicId: 4, name: "AlmostAirbytkd" }),
  ];

  it("matches exact names case-insensitively", () => {
    const result = matchPasteNamesToLastRankMembers(["airbytkd", "RC81"], roster);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0].matchMethod).toBe("exact");
    expect(result.matched[0].profileUrl).toBe("https://lastrank.fun/p/1");
    expect(result.unmatched).toHaveLength(0);
  });

  it("matches emoji names", () => {
    const result = matchPasteNamesToLastRankMembers(["Myster⚔️Zero"], roster);
    expect(result.matched[0]?.lastRank.publicId).toBe(3);
  });

  it("reports unmatched with suggestions", () => {
    const result = matchPasteNamesToLastRankMembers(["NobodyHere"], roster);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]?.status).toBe("unmatched");
    expect(result.unmatched[0]?.suggestions.length).toBeGreaterThan(0);
  });

  it("claims each LastRank member once", () => {
    const result = matchPasteNamesToLastRankMembers(
      ["Airbytkd", "Airbytkd"],
      roster,
    );
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(1);
  });
});

describe("formatPasteProfileLinksMarkdown", () => {
  it("formats a Markdown list with optional alliance name", () => {
    const md = formatPasteProfileLinksMarkdown({
      tag: "BigD",
      gameServerNumber: 1203,
      allianceName: "Big Daddies",
      matched: [
        {
          status: "matched",
          pasteName: "RC81",
          lastRank: member({ publicId: 99, name: "RC81" }),
          matchMethod: "exact",
          fuzzyScore: null,
          profileUrl: "https://lastrank.fun/p/99",
        },
      ],
    });
    expect(md).toContain("# Big Daddies (BigD) — S1203 LastRank profiles");
    expect(md).toContain("- [RC81](https://lastrank.fun/p/99)");
  });
});
