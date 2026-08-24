import { describe, expect, it } from "vitest";

import {
  applyInteractiveMatches,
  buildInteractiveHqChoices,
  formatLastRankPowerLevel,
  matchLastRankMembersToHq,
  parseLastRankAllianceHtml,
  parseLastRankSectionRanks,
  parseLastRankSyncMap,
  resolveHqNameToRosterRow,
  resolveInteractiveHqNameAnswer,
  type LastRankHqRosterRow,
} from "@/lib/lastrank/alliance-page.shared";

function htmlWithMembers(
  members: Array<Record<string, unknown>>,
): string {
  const tree = ["$", "div", null, { className: "x", children: [{ members }] }];
  const inner = `1e:${JSON.stringify(tree)}`;
  const push = JSON.stringify([1, inner]);
  return `<!DOCTYPE html><html><body><script>self.__next_f.push(${push})</script></body></html>`;
}

function rankSection(rank: number, publicIds: number[]): string {
  const rows = publicIds
    .map(
      (id) =>
        `<tr><td><a href="/p/${id}">Player ${id}</a></td></tr>`,
    )
    .join("");
  return `<section class="rounded-md border overflow-hidden"><button type="button"><span title="Rank" class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-mono font-bold bg-accent-amber/20">R${rank}</span><span class="flex-1"></span><span class="font-mono text-xs">${publicIds.length}</span></button><div><table><tbody>${rows}</tbody></table></div></section>`;
}

function hqRow(
  partial: Partial<LastRankHqRosterRow> & {
    commanderId: string;
    ashedMemberId: string;
    currentNames: string[];
  },
): LastRankHqRosterRow {
  return {
    previousNames: [],
    gameUid: null,
    hqThp: null,
    hqLevel: null,
    hqPowerLevel: null,
    hqAllianceRank: null,
    existingCanonicalName: null,
    lastrankPublicId: null,
    lastrankCountry: null,
    lastrankProfileImageUrl: null,
    lastrankProfileUrl: null,
    ...partial,
  };
}

describe("parseLastRankSectionRanks", () => {
  it("maps player links under R1–R5 section badges", () => {
    const html = [
      rankSection(5, [1314756]),
      rankSection(4, [1314754, 1314830]),
      rankSection(3, [1314669]),
    ].join("\n");
    const ranks = parseLastRankSectionRanks(html);
    expect(ranks.get(1314756)).toBe(5);
    expect(ranks.get(1314754)).toBe(4);
    expect(ranks.get(1314830)).toBe(4);
    expect(ranks.get(1314669)).toBe(3);
  });

  it("overrides RSC alliance_rank with section badge rank", () => {
    const members = [
      {
        public_id: 1314756,
        name: "Redd KOTF",
        country: "US",
        power: 1,
        hero_power: 2,
        alliance_rank: 3,
        base_level: 35,
        origin_server_id: 1,
      },
    ];
    const html =
      htmlWithMembers(members) + rankSection(5, [1314756]);
    const page = parseLastRankAllianceHtml(
      html,
      "e7d1eaefdcfc42c8ac6c84247d2dad9b",
    );
    expect(page.members[0]?.allianceRank).toBe(5);
  });
});

describe("parseLastRankAllianceHtml", () => {
  it("extracts members from Next.js flight payload", () => {
    const html = htmlWithMembers([
      {
        public_id: 1314669,
        name: "Bane Pig",
        country: "US",
        power: 394409538,
        hero_power: 253849850,
        alliance_rank: 3,
        base_level: 35,
        origin_server_id: 1218,
      },
    ]);
    const page = parseLastRankAllianceHtml(
      html,
      "e7d1eaefdcfc42c8ac6c84247d2dad9b",
    );
    expect(page.members).toHaveLength(1);
    expect(page.members[0]).toMatchObject({
      publicId: 1314669,
      name: "Bane Pig",
      heroPower: 253849850,
      power: 394409538,
      baseLevel: 35,
    });
  });

  it("parses members when the flight string contains closing brackets", () => {
    const html = htmlWithMembers([
      {
        public_id: 2,
        name: "Brackets]OK",
        country: "US",
        power: 1,
        hero_power: 2,
        alliance_rank: 1,
        base_level: 10,
        origin_server_id: 1,
      },
    ]);
    const page = parseLastRankAllianceHtml(html, "e7d1eaefdcfc42c8ac6c84247d2dad9b");
    expect(page.members[0]?.name).toBe("Brackets]OK");
  });

  it("rejects Cloudflare challenge pages", () => {
    expect(() =>
      parseLastRankAllianceHtml(
        "<html>Just a moment...</html>",
        "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      ),
    ).toThrow(/Cloudflare/);
  });
});

describe("matchLastRankMembersToHq cascade", () => {
  const lastRankMember = {
    publicId: 1,
    name: "Bane Pig",
    country: "US" as string | null,
    power: 1 as number | null,
    heroPower: 2 as number | null,
    allianceRank: 3 as number | null,
    baseLevel: 35 as number | null,
    originServerId: 1203 as number | null,
  };

  it("matches stored lastrank_public_id before name cascade", () => {
    const result = matchLastRankMembersToHq(
      [lastRankMember],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["Renamed Commander"],
          lastrankPublicId: 1,
        }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchMethod).toBe("lastrank_public_id");
  });

  it("exact-matches current names before previous", () => {
    const result = matchLastRankMembersToHq(
      [lastRankMember],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["Bane Pig"],
          previousNames: ["Other"],
        }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchMethod).toBe("exact_current");
  });

  it("exact-matches previous names when current miss", () => {
    const result = matchLastRankMembersToHq(
      [lastRankMember],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["Old Current"],
          previousNames: ["Bane Pig"],
        }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchMethod).toBe("exact_previous");
  });

  it("fuzzy-matches current names when exact miss", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          ...lastRankMember,
          name: "Lil Belly",
        },
      ],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["LilBelly"],
        }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchMethod).toBe("fuzzy_current");
    expect(result.matched[0].fuzzyScore).toBeGreaterThan(0.6);
  });

  it("fuzzy-matches previous names after current fuzzy miss", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          ...lastRankMember,
          name: "Lil Belly",
        },
      ],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["TotallyDifferent"],
          previousNames: ["LilBelly"],
        }),
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchMethod).toBe("fuzzy_previous");
  });

  it("leaves distant names unmatched with suggestions", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          ...lastRankMember,
          name: "zzzz-nope",
        },
      ],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["Alpha"],
        }),
      ],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]?.status).toBe("unmatched");
    expect(result.unmatched[0]?.suggestions.length).toBeGreaterThan(0);
  });

  it("marks duplicate HQ current names as ambiguous", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          ...lastRankMember,
          name: "Twin",
        },
      ],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["Twin"],
        }),
        hqRow({
          commanderId: "c2",
          ashedMemberId: "m2",
          currentNames: ["Twin"],
        }),
      ],
    );
    expect(result.unmatched[0]?.status).toBe("ambiguous");
  });
});

describe("resolveInteractiveHqNameAnswer", () => {
  const choices = [
    { name: "Zudiedwdx", score: 0.56 },
    { name: "Slow", score: 0.38 },
    { name: "bdooo", score: null },
  ];

  it("returns skip for blank input", () => {
    expect(resolveInteractiveHqNameAnswer("", choices)).toEqual({
      kind: "skip",
    });
    expect(resolveInteractiveHqNameAnswer("   ", choices)).toEqual({
      kind: "skip",
    });
  });

  it("returns create for c / C", () => {
    expect(resolveInteractiveHqNameAnswer("c", choices)).toEqual({
      kind: "create",
    });
    expect(resolveInteractiveHqNameAnswer("C", choices)).toEqual({
      kind: "create",
    });
  });

  it("maps 1-based index to menu choice", () => {
    expect(resolveInteractiveHqNameAnswer("1", choices)).toEqual({
      kind: "match",
      hqName: "Zudiedwdx",
    });
    expect(resolveInteractiveHqNameAnswer("3", choices)).toEqual({
      kind: "match",
      hqName: "bdooo",
    });
  });

  it("passes through out-of-range numbers as typed names", () => {
    expect(resolveInteractiveHqNameAnswer("99", choices)).toEqual({
      kind: "match",
      hqName: "99",
    });
  });

  it("passes through non-numeric strings as HQ roster names", () => {
    expect(resolveInteractiveHqNameAnswer("EG Sie", choices)).toEqual({
      kind: "match",
      hqName: "EG Sie",
    });
    expect(resolveInteractiveHqNameAnswer("●モりノ", choices)).toEqual({
      kind: "match",
      hqName: "●モりノ",
    });
  });
});

describe("buildInteractiveHqChoices", () => {
  it("lists suggestions first then remaining unmatched HQ without duplicates", () => {
    expect(
      buildInteractiveHqChoices({
        suggestions: [
          { commanderId: "c1", name: "Zudiedwdx", score: 0.56 },
          { commanderId: "c2", name: "Slow", score: 0.38 },
        ],
        remainingHqNames: ["Slow", "Roby", "Lulu"],
      }),
    ).toEqual([
      { name: "Zudiedwdx", score: 0.56 },
      { name: "Slow", score: 0.38 },
      { name: "Roby", score: null },
      { name: "Lulu", score: null },
    ]);
  });
});

describe("resolveHqNameToRosterRow + interactive apply", () => {
  it("resolves operator-typed HQ name and applies interactive match", () => {
    const hq = hqRow({
      commanderId: "c1",
      ashedMemberId: "m1",
      currentNames: ["Mr BELLY"],
    });
    const lastRank = {
      publicId: 9,
      name: "Lil Belly",
      country: null,
      power: null,
      heroPower: 1,
      allianceRank: null,
      baseLevel: null,
      originServerId: null,
    };
    const base = matchLastRankMembersToHq([lastRank], [hq], {
      fuzzyMinScore: 0.99,
    });
    expect(base.unmatched).toHaveLength(1);

    const resolved = resolveHqNameToRosterRow("Mr BELLY", [hq], new Set());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const next = applyInteractiveMatches(base, [
      { lastRankPublicId: 9, hq: resolved.hq },
    ]);
    expect(next.matched).toHaveLength(1);
    expect(next.matched[0].matchMethod).toBe("interactive");
    expect(next.unmatched).toHaveLength(0);
  });
});

describe("parseLastRankSyncMap", () => {
  it("parses tag=hex pairs", () => {
    expect(
      parseLastRankSyncMap("LFgo=e7d1eaefdcfc42c8ac6c84247d2dad9b"),
    ).toEqual([
      { tag: "LFgo", lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b" },
    ]);
  });
});

describe("formatLastRankPowerLevel", () => {
  it("formats raw power as millions", () => {
    expect(formatLastRankPowerLevel(394409538)).toBe("394.4M");
  });
});
