import { describe, expect, it } from "vitest";

import {
  applyInteractiveMatches,
  applyProfessionBadgesToMembers,
  buildInteractiveHqChoices,
  decideLastRankProfessionApply,
  formatLastRankPowerLevel,
  isLastRankUnranked,
  LASTRANK_PROFESSION_HQ_RECENT_DAYS,
  lastRankMemberEligibleForCreate,
  lastRankPlayerProfileUrl,
  matchLastRankMembersToHq,
  parseLastRankAllianceHtml,
  parseLastRankProfessionBadges,
  parseLastRankSectionRanks,
  resolveHqNameToRosterRow,
  resolveInteractiveHqNameAnswer,
  type LastRankAllianceMember,
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
    hqProfession: null,
    hqProfessionLevel: null,
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
      profession: null,
      professionLevel: null,
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

  it("maps career_type / career_lv to profession and level", () => {
    const base = {
      country: "US",
      power: 1,
      hero_power: 2,
      alliance_rank: 4,
      base_level: 35,
      origin_server_id: 1218,
    };
    const page = parseLastRankAllianceHtml(
      htmlWithMembers([
        { ...base, public_id: 1, name: "Wl", career_type: 102, career_lv: 100 },
        { ...base, public_id: 2, name: "Eng", career_type: 101, career_lv: 30 },
        { ...base, public_id: 3, name: "None", career_type: 0, career_lv: 0 },
      ]),
      "e7d1eaefdcfc42c8ac6c84247d2dad9b",
    );
    expect(
      page.members.map((m) => [m.name, m.profession, m.professionLevel]),
    ).toEqual([
      ["Wl", "War Leader", 100],
      ["Eng", "Engineer", 30],
      ["None", null, null],
    ]);
  });

  it("falls back to the rendered badge when the payload omits career fields", () => {
    const html = htmlWithMembers([
      {
        public_id: 1314756,
        name: "Redd",
        country: "US",
        power: 1,
        hero_power: 2,
        alliance_rank: 5,
        base_level: 35,
        origin_server_id: 1218,
      },
    ]).replace(
      "</body>",
      `<table><tbody><tr><td><a href="/p/1314756">Redd</a></td><td><span title="Líder de Guerra · Nv 100"><span aria-hidden="true">⚔</span><span class="font-bold">WL</span><span class="hidden sm:inline">· Nv <!-- -->100</span></span></td><td>Nv 35</td></tr></tbody></table></body>`,
    );
    const page = parseLastRankAllianceHtml(html, "e7d1eaefdcfc42c8ac6c84247d2dad9b");
    expect(page.members[0]).toMatchObject({
      profession: "War Leader",
      professionLevel: 100,
    });
  });
});

describe("parseLastRankProfessionBadges", () => {
  it("accepts Lv or Nv and ignores the HQ Lv cell", () => {
    const html = [
      `<tr><td><a href="/p/1">A</a></td><td><span title="War Leader · Lv 100"><span aria-hidden="true">⚔</span><span class="font-bold">WL</span><span>· Lv 100</span></span></td><td>Lv 35</td></tr>`,
      `<tr><td><a href="/p/2">B</a></td><td><span title="Engenheiro · Nv 30"><span aria-hidden="true">🛠</span><span class="font-bold">ENG</span><span>· Nv <!-- -->30</span></span></td><td>Nv 35</td></tr>`,
      `<tr><td><a href="/p/3">C</a></td><td></td><td>Nv 20</td></tr>`,
    ].join("");
    const badges = parseLastRankProfessionBadges(html);
    expect(badges.get(1)).toEqual({ profession: "War Leader", professionLevel: 100 });
    expect(badges.get(2)).toEqual({ profession: "Engineer", professionLevel: 30 });
    expect(badges.has(3)).toBe(false);
  });
});

describe("applyProfessionBadgesToMembers", () => {
  const member = (
    publicId: number,
    profession: "War Leader" | "Engineer" | null,
    professionLevel: number | null,
  ): LastRankAllianceMember => ({
    publicId,
    name: `P${publicId}`,
    country: null,
    power: null,
    heroPower: null,
    allianceRank: null,
    baseLevel: null,
    profession,
    professionLevel,
    originServerId: null,
  });
  const badges = new Map([
    [1, { profession: "War Leader" as const, professionLevel: 100 }],
    [2, { profession: "Engineer" as const, professionLevel: 30 }],
    [3, { profession: "Engineer" as const, professionLevel: 40 }],
    [4, { profession: "Engineer" as const, professionLevel: 50 }],
  ]);

  it("fills a missing level from the badge when the payload already has the profession", () => {
    const [out] = applyProfessionBadgesToMembers([member(1, "War Leader", null)], badges);
    expect(out).toMatchObject({ profession: "War Leader", professionLevel: 100 });
  });

  it("fills both fields when the payload has neither", () => {
    const [out] = applyProfessionBadgesToMembers([member(2, null, null)], badges);
    expect(out).toMatchObject({ profession: "Engineer", professionLevel: 30 });
  });

  it("keeps payload values that are present", () => {
    const [out] = applyProfessionBadgesToMembers([member(3, "Engineer", 45)], badges);
    expect(out).toMatchObject({ profession: "Engineer", professionLevel: 45 });
  });

  it("does not borrow a level from a badge for a different profession", () => {
    const [out] = applyProfessionBadgesToMembers([member(4, "War Leader", null)], badges);
    expect(out).toMatchObject({ profession: "War Leader", professionLevel: null });
  });
});

describe("decideLastRankProfessionApply", () => {
  const wl100 = { profession: "War Leader" as const, professionLevel: 100 };

  it("fills an empty HQ profession and level", () => {
    expect(
      decideLastRankProfessionApply(
        { hqProfession: null, hqProfessionLevel: null },
        wl100,
      ),
    ).toEqual({ profession: "apply", level: "apply" });
  });

  const now = new Date("2026-10-06T12:00:00Z");
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it("keeps a recent HQ profession change and skips the level", () => {
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "Engineer", hqProfessionLevel: 20 },
        wl100,
        { hqProfessionChangedAt: daysAgo(2), now },
      ),
    ).toEqual({ profession: "conflict", level: "missing" });
  });

  it("switches a stale HQ profession and adopts the LastRank level", () => {
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "Engineer", hqProfessionLevel: 120 },
        wl100,
        {
          hqProfessionChangedAt: daysAgo(LASTRANK_PROFESSION_HQ_RECENT_DAYS),
          now,
        },
      ),
    ).toEqual({ profession: "switch", level: "apply" });
  });

  it("treats an undated HQ profession as stale", () => {
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "Engineer", hqProfessionLevel: 20 },
        wl100,
        { hqProfessionChangedAt: null, now },
      ).profession,
    ).toBe("switch");
  });

  it("raises level but treats a lower LastRank level as stale", () => {
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "War Leader", hqProfessionLevel: 90 },
        wl100,
      ),
    ).toEqual({ profession: "unchanged", level: "apply" });
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "War Leader", hqProfessionLevel: 100 },
        wl100,
      ).level,
    ).toBe("unchanged");
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "War Leader", hqProfessionLevel: 110 },
        wl100,
      ).level,
    ).toBe("conflict");
  });

  it("does nothing when LastRank has no profession", () => {
    expect(
      decideLastRankProfessionApply(
        { hqProfession: "Engineer", hqProfessionLevel: 30 },
        { profession: null, professionLevel: null },
      ),
    ).toEqual({ profession: "missing", level: "missing" });
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
    profession: null,
    professionLevel: null,
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

  it("does not auto-match sole fuzzy current names (cron must not stamp ranks)", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          ...lastRankMember,
          name: "Lil Belly",
          allianceRank: 5,
        },
      ],
      [
        hqRow({
          commanderId: "c1",
          ashedMemberId: "m1",
          currentNames: ["LilBelly"],
          hqAllianceRank: 3,
          hqProfession: null,
          hqProfessionLevel: null,
        }),
      ],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.status).toBe("unmatched");
    expect(result.unmatched[0]?.suggestions[0]?.commanderId).toBe("c1");
    expect(result.unmatched[0]?.suggestions[0]?.score).toBeGreaterThan(0.6);
  });

  it("does not auto-match sole fuzzy previous names", () => {
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
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]?.status).toBe("unmatched");
    expect(result.unmatched[0]?.suggestions[0]?.commanderId).toBe("c1");
  });

  it("does not auto-match distinct near-miss names that would unlock R5 invites", () => {
    // Mike↔Nike ≈ 0.75 — above LASTRANK_FUZZY_MATCH_MIN (0.6) but different people.
    const result = matchLastRankMembersToHq(
      [
        {
          ...lastRankMember,
          name: "Nike",
          allianceRank: 5,
        },
      ],
      [
        hqRow({
          commanderId: "c-mike",
          ashedMemberId: "m-mike",
          currentNames: ["Mike"],
          hqAllianceRank: 1,
          hqProfession: null,
          hqProfessionLevel: null,
        }),
      ],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]?.suggestions[0]?.commanderId).toBe("c-mike");
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
      profession: null,
      professionLevel: null,
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

describe("formatLastRankPowerLevel", () => {
  it("formats raw power as millions", () => {
    expect(formatLastRankPowerLevel(394409538)).toBe("394.4M");
  });
});

describe("lastRankPlayerProfileUrl", () => {
  it("builds the public profile path", () => {
    expect(lastRankPlayerProfileUrl(193049)).toBe(
      "https://lastrank.fun/p/193049",
    );
  });
});

describe("isLastRankUnranked", () => {
  it("treats missing or out-of-band ranks as unranked", () => {
    expect(isLastRankUnranked({ allianceRank: null })).toBe(true);
    expect(isLastRankUnranked({ allianceRank: 0 })).toBe(true);
    expect(isLastRankUnranked({ allianceRank: 6 })).toBe(true);
    expect(isLastRankUnranked({ allianceRank: 1.5 })).toBe(true);
  });

  it("treats R1–R5 as ranked", () => {
    expect(isLastRankUnranked({ allianceRank: 1 })).toBe(false);
    expect(isLastRankUnranked({ allianceRank: 5 })).toBe(false);
  });
});

describe("lastRankMemberEligibleForCreate", () => {
  it("allows ranked members and rejects unranked leavers", () => {
    expect(lastRankMemberEligibleForCreate({ allianceRank: 1 })).toBe(true);
    expect(lastRankMemberEligibleForCreate({ allianceRank: 5 })).toBe(true);
    expect(lastRankMemberEligibleForCreate({ allianceRank: null })).toBe(false);
  });
});
