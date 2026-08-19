import { describe, expect, it } from "vitest";

import {
  formatLastRankPowerLevel,
  matchLastRankMembersToHq,
  parseLastRankAllianceHtml,
  parseLastRankSyncMap,
} from "@/lib/lastrank/alliance-page.shared";

function htmlWithMembers(
  members: Array<Record<string, unknown>>,
): string {
  const tree = ["$", "div", null, { className: "x", children: [{ members }] }];
  const inner = `1e:${JSON.stringify(tree)}`;
  const push = JSON.stringify([1, inner]);
  return `<!DOCTYPE html><html><body><script>self.__next_f.push(${push})</script></body></html>`;
}

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

describe("matchLastRankMembersToHq", () => {
  it("matches exact normalized names including previous names", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          publicId: 1,
          name: "Bane Pig",
          country: "US",
          power: 1,
          heroPower: 2,
          allianceRank: 3,
          baseLevel: 35,
          originServerId: 1203,
        },
      ],
      [
        {
          commanderId: "c1",
          ashedMemberId: "m1",
          names: ["Old Name", "Bane Pig"],
          hqThp: 100,
          hqLevel: 34,
          hqPowerLevel: "300M",
        },
      ],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].hq.commanderId).toBe("c1");
    expect(result.unmatched).toHaveLength(0);
  });

  it("does not fuzzy-match distinct names", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          publicId: 1,
          name: "Lil Belly",
          country: null,
          power: null,
          heroPower: 1,
          allianceRank: null,
          baseLevel: null,
          originServerId: null,
        },
      ],
      [
        {
          commanderId: "c1",
          ashedMemberId: "m1",
          names: ["Mr BELLY"],
          hqThp: null,
          hqLevel: null,
          hqPowerLevel: null,
        },
      ],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]?.status).toBe("unmatched");
  });

  it("marks duplicate HQ names as ambiguous", () => {
    const result = matchLastRankMembersToHq(
      [
        {
          publicId: 1,
          name: "Twin",
          country: null,
          power: null,
          heroPower: 1,
          allianceRank: null,
          baseLevel: null,
          originServerId: null,
        },
      ],
      [
        {
          commanderId: "c1",
          ashedMemberId: "m1",
          names: ["Twin"],
          hqThp: null,
          hqLevel: null,
          hqPowerLevel: null,
        },
        {
          commanderId: "c2",
          ashedMemberId: "m2",
          names: ["Twin"],
          hqThp: null,
          hqLevel: null,
          hqPowerLevel: null,
        },
      ],
    );
    expect(result.unmatched[0]?.status).toBe("ambiguous");
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
