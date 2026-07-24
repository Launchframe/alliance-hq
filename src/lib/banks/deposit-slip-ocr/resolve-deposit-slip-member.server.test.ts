import { describe, expect, it, vi } from "vitest";

import {
  DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN,
  applyResolvedAllianceTagToDepositSlip,
  createDepositSlipMemberResolverCache,
  pickUniqueFuzzyAllianceTag,
  resolveDepositSlipMemberLinks,
} from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
import type { AshedMember } from "@/lib/video/member-matcher";

const members: AshedMember[] = [
  {
    id: "ashed-blue",
    current_name: "Blue Investor",
    previous_names: ["BlueInvestor"],
    status: "active",
  },
  {
    id: "ashed-orange",
    current_name: "Orange Investor",
    status: "active",
  },
];

describe("pickUniqueFuzzyAllianceTag", () => {
  const candidates = [
    {
      id: "alliance-roar",
      tag: "Roar",
      name: "Roar",
      ownerAshedUserId: null,
    },
    {
      id: "alliance-grow",
      tag: "GRoW",
      name: "Grow",
      ownerAshedUserId: null,
    },
  ];

  it("accepts a unique high-similarity OCR glitch on the tag", () => {
    const hit = pickUniqueFuzzyAllianceTag("Roa", candidates);
    expect(hit?.candidate.id).toBe("alliance-roar");
    expect(hit?.score).toBe(0.75);
  });

  it("rejects short tags and ambiguous near-ties", () => {
    expect(pickUniqueFuzzyAllianceTag("Ro", candidates)).toBeNull();
    expect(
      pickUniqueFuzzyAllianceTag("xx", [
        { id: "a", tag: "aa", name: "A", ownerAshedUserId: null },
        { id: "b", tag: "ab", name: "B", ownerAshedUserId: null },
      ]),
    ).toBeNull();
  });
});

describe("resolveDepositSlipMemberLinks", () => {
  const roarAlliance = {
    id: "alliance-roar",
    tag: "Roar",
    name: "Roar",
    ownerAshedUserId: null,
  };
  const bankAlliance = {
    id: "alliance-bank",
    tag: "BankTag",
    name: "Bank",
    ownerAshedUserId: null,
  };

  it("resolves a unique tag and exact commander name into all three FKs", async () => {
    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roar",
        commanderName: "Blue Investor",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([roarAlliance]),
        listAlliancesWithTags: vi.fn().mockResolvedValue([roarAlliance, bankAlliance]),
        loadRosterMembers: vi.fn().mockResolvedValue(members),
        findAllianceMemberId: vi.fn().mockResolvedValue("am-blue"),
        resolveCommanderId: vi.fn().mockResolvedValue("cmd-blue"),
      },
    );

    expect(result).toMatchObject({
      depositAllianceId: "alliance-roar",
      rosterAllianceId: "alliance-roar",
      resolvedAllianceTag: "Roar",
      allianceMemberId: "am-blue",
      commanderId: "cmd-blue",
      ashedMemberId: "ashed-blue",
      matchMethod: "exact",
      matchConfidence: 1,
      candidateAshedMemberId: "ashed-blue",
      candidateMemberName: "Blue Investor",
      tagMatchMethod: "exact",
      tagMatchConfidence: 1,
    });
  });

  it("fuzzy-resolves a unique OCR-glitched tag then exact-matches the name", async () => {
    const listAlliancesByTag = vi.fn().mockResolvedValue([]);
    const listAlliancesWithTags = vi.fn().mockResolvedValue([
      { id: "alliance-roar", tag: "Roar", name: "Roar", ownerAshedUserId: null },
      { id: "alliance-grow", tag: "GRoW", name: "Grow", ownerAshedUserId: null },
    ]);
    const loadRosterMembers = vi.fn().mockResolvedValue(members);

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roa",
        commanderName: "Blue Investor",
      },
      {
        listAlliancesByTag,
        listAlliancesWithTags,
        loadRosterMembers,
        findAllianceMemberId: vi.fn().mockResolvedValue("am-blue"),
        resolveCommanderId: vi.fn().mockResolvedValue("cmd-blue"),
      },
    );

    expect(listAlliancesByTag).toHaveBeenCalledWith("Roa");
    expect(listAlliancesWithTags).toHaveBeenCalled();
    expect(loadRosterMembers).toHaveBeenCalledWith("alliance-roar");
    expect(result.depositAllianceId).toBe("alliance-roar");
    expect(result.rosterAllianceId).toBe("alliance-roar");
    expect(result.resolvedAllianceTag).toBe("Roar");
    expect(result.tagMatchMethod).toBe("fuzzy");
    expect(result.tagMatchConfidence).toBe(0.75);
    expect(result.allianceMemberId).toBe("am-blue");
    expect(result.matchMethod).toBe("exact");
    // Exact name + fuzzy tag must not display as 100% in review.
    expect(result.candidateConfidence).toBe(0.75);
    expect(result.matchConfidence).toBe(0.75);
  });

  it("prefers preferredAshedMemberId over commander name rematch", async () => {
    const findAllianceMemberId = vi.fn().mockResolvedValue("am-orange");
    const resolveCommanderId = vi.fn().mockResolvedValue("cmd-orange");

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roar",
        commanderName: "Blue Investor",
        preferredAshedMemberId: "ashed-orange",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([roarAlliance]),
        listAlliancesWithTags: vi.fn().mockResolvedValue([roarAlliance]),
        loadRosterMembers: vi.fn().mockResolvedValue(members),
        findAllianceMemberId,
        resolveCommanderId,
      },
    );

    expect(result.ashedMemberId).toBe("ashed-orange");
    expect(result.allianceMemberId).toBe("am-orange");
    expect(result.commanderId).toBe("cmd-orange");
    expect(findAllianceMemberId).toHaveBeenCalledWith(
      "alliance-roar",
      "ashed-orange",
    );
  });

  it("leaves depositAllianceId null when the tag is ambiguous and matches against the bank alliance roster", async () => {
    const loadRosterMembers = vi.fn().mockResolvedValue(members);
    const findAllianceMemberId = vi.fn().mockResolvedValue("am-orange");
    const resolveCommanderId = vi.fn().mockResolvedValue("cmd-orange");

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "LF",
        commanderName: "Orange Investor",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([
          { id: "a1", tag: "LF", name: "One", ownerAshedUserId: null },
          { id: "a2", tag: "LF", name: "Two", ownerAshedUserId: null },
        ]),
        listAlliancesWithTags: vi.fn().mockResolvedValue([
          {
            id: "alliance-bank",
            tag: "LFgo",
            name: "LFgo",
            ownerAshedUserId: null,
          },
        ]),
        loadRosterMembers,
        findAllianceMemberId,
        resolveCommanderId,
      },
    );

    expect(result.depositAllianceId).toBeNull();
    expect(result.rosterAllianceId).toBe("alliance-bank");
    expect(result.resolvedAllianceTag).toBe("LFgo");
    expect(result.tagMatchMethod).toBe("ambiguous");
    expect(loadRosterMembers).toHaveBeenCalledWith("alliance-bank");
    expect(findAllianceMemberId).toHaveBeenCalledWith(
      "alliance-bank",
      "ashed-orange",
    );
    expect(result.allianceMemberId).toBe("am-orange");
    expect(result.commanderId).toBe("cmd-orange");
    expect(result.matchMethod).toBe("exact");
  });

  it("falls back to the bank alliance roster when no tag is present", async () => {
    const loadRosterMembers = vi.fn().mockResolvedValue(members);

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: null,
        commanderName: "BlueInvestor",
      },
      {
        listAlliancesByTag: vi.fn(),
        listAlliancesWithTags: vi.fn().mockResolvedValue([bankAlliance]),
        loadRosterMembers,
        findAllianceMemberId: vi.fn().mockResolvedValue("am-blue"),
        resolveCommanderId: vi.fn().mockResolvedValue(null),
      },
    );

    expect(result.depositAllianceId).toBeNull();
    expect(loadRosterMembers).toHaveBeenCalledWith("alliance-bank");
    expect(result.allianceMemberId).toBe("am-blue");
    expect(result.commanderId).toBeNull();
    expect(result.ashedMemberId).toBe("ashed-blue");
    expect(result.matchMethod).toBe("previous_name");
  });

  it("surfaces weak fuzzy candidates without auto-linking FKs", async () => {
    const weakMembers: AshedMember[] = [
      {
        id: "ashed-close",
        // "Blue Investor" vs "Blu Investar" is fuzzy but typically < 0.85
        current_name: "Blu Investar",
        status: "active",
      },
    ];

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roar",
        commanderName: "Blue Investor",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([roarAlliance]),
        listAlliancesWithTags: vi.fn().mockResolvedValue([roarAlliance]),
        loadRosterMembers: vi.fn().mockResolvedValue(weakMembers),
        findAllianceMemberId: vi.fn(),
        resolveCommanderId: vi.fn(),
      },
    );

    expect(result.candidateMatchMethod).toBe("fuzzy");
    expect(result.candidateAshedMemberId).toBe("ashed-close");
    expect(result.candidateConfidence).toBeGreaterThan(0);
    expect(result.candidateConfidence).toBeLessThan(
      DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN,
    );
    expect(result.allianceMemberId).toBeNull();
    expect(result.commanderId).toBeNull();
    expect(result.ashedMemberId).toBeNull();
    expect(result.matchMethod).toBe("none");
    expect(result.matchConfidence).toBe(0);
  });

  it("refuses to auto-link when both the tag and the commander name are only weakly fuzzy", async () => {
    // Tag "Roa" is a unique fuzzy hit for "Roar" (0.75+), but the commander
    // name only weakly matches a member on that roster (<0.85) — dual-weak
    // must not write FKs, only surface the candidate.
    const weakMembers: AshedMember[] = [
      {
        id: "ashed-close",
        current_name: "Blu Investar",
        status: "active",
      },
    ];
    const listAlliancesByTag = vi.fn().mockResolvedValue([]);
    const listAlliancesWithTags = vi.fn().mockResolvedValue([
      { id: "alliance-roar", tag: "Roar", name: "Roar", ownerAshedUserId: null },
      { id: "alliance-grow", tag: "GRoW", name: "Grow", ownerAshedUserId: null },
    ]);

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roa",
        commanderName: "Blue Investor",
      },
      {
        listAlliancesByTag,
        listAlliancesWithTags,
        loadRosterMembers: vi.fn().mockResolvedValue(weakMembers),
        findAllianceMemberId: vi.fn(),
        resolveCommanderId: vi.fn(),
      },
    );

    expect(result.tagMatchMethod).toBe("fuzzy");
    expect(result.depositAllianceId).toBe("alliance-roar");
    expect(result.candidateMatchMethod).toBe("fuzzy");
    expect(result.candidateConfidence).toBeLessThan(
      DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN,
    );
    expect(result.allianceMemberId).toBeNull();
    expect(result.commanderId).toBeNull();
    expect(result.matchMethod).toBe("none");
  });

  it("does not surface weak bank-roster fallback candidates below auto-link threshold", async () => {
    const weakMembers: AshedMember[] = [
      {
        id: "ashed-jimmy",
        current_name: "JIMMY DwDx",
        status: "active",
      },
    ];

    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-lfgo",
        depositAllianceTag: "B1GG",
        commanderName: "JEmma",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([]),
        listAlliancesWithTags: vi.fn().mockResolvedValue([
          {
            id: "alliance-lfgo",
            tag: "LFgo",
            name: "LFgo",
            ownerAshedUserId: null,
          },
        ]),
        loadRosterMembers: vi.fn().mockResolvedValue(weakMembers),
        findAllianceMemberId: vi.fn(),
        resolveCommanderId: vi.fn(),
      },
    );

    expect(result.tagMatchMethod).toBe("none");
    expect(result.rosterAllianceId).toBe("alliance-lfgo");
    expect(result.candidateAshedMemberId).toBeNull();
    expect(result.candidateMemberName).toBeNull();
    expect(result.candidateConfidence).toBe(0);
    expect(result.allianceMemberId).toBeNull();
    expect(result.ashedMemberId).toBeNull();
  });

  it("returns null member FKs when the commander name does not match", async () => {
    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roar",
        commanderName: "Completely Unknown",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([roarAlliance]),
        listAlliancesWithTags: vi.fn().mockResolvedValue([roarAlliance]),
        loadRosterMembers: vi.fn().mockResolvedValue(members),
        findAllianceMemberId: vi.fn(),
        resolveCommanderId: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      depositAllianceId: "alliance-roar",
      allianceMemberId: null,
      commanderId: null,
      ashedMemberId: null,
      matchMethod: "none",
      matchConfidence: 0,
      candidateAshedMemberId: null,
      tagMatchMethod: "exact",
    });
  });
});

describe("applyResolvedAllianceTagToDepositSlip", () => {
  it("overwrites OCR alliance tag when auto-linked to a roster alliance", () => {
    const slip = {
      identity: { allianceTag: "LFga" as string | null },
    };
    applyResolvedAllianceTagToDepositSlip(slip, {
      ashedMemberId: "ashed-1",
      resolvedAllianceTag: "LFgo",
    });
    expect(slip.identity.allianceTag).toBe("LFgo");
  });

  it("does not change tag when not auto-linked or tag already matches", () => {
    const slip = { identity: { allianceTag: "LFga" as string | null } };
    applyResolvedAllianceTagToDepositSlip(slip, {
      ashedMemberId: null,
      resolvedAllianceTag: "LFgo",
    });
    expect(slip.identity.allianceTag).toBe("LFga");

    applyResolvedAllianceTagToDepositSlip(slip, {
      ashedMemberId: "ashed-1",
      resolvedAllianceTag: "LFga",
    });
    expect(slip.identity.allianceTag).toBe("LFga");
  });
});

describe("createDepositSlipMemberResolverCache", () => {
  it("fetches the alliance-tag list and each alliance's roster only once across a batch", async () => {
    const listAlliancesByTag = vi.fn().mockResolvedValue([]);
    const listAlliancesWithTags = vi.fn().mockResolvedValue([
      { id: "alliance-roar", tag: "Roar", name: "Roar", ownerAshedUserId: null },
    ]);
    const loadRosterMembers = vi.fn().mockResolvedValue(members);
    const findAllianceMemberId = vi.fn().mockResolvedValue("am-blue");
    const resolveCommanderId = vi.fn().mockResolvedValue("cmd-blue");

    const cache = createDepositSlipMemberResolverCache({
      listAlliancesByTag,
      listAlliancesWithTags,
      loadRosterMembers,
      findAllianceMemberId,
      resolveCommanderId,
    });

    // Three rows sharing the same OCR-glitched tag and roster alliance —
    // without caching this would be 3 full alliance-table scans + 3 roster
    // fetches for the same alliance.
    await Promise.all([
      resolveDepositSlipMemberLinks(
        { bankAllianceId: "alliance-bank", depositAllianceTag: "Roa", commanderName: "Blue Investor" },
        cache,
      ),
      resolveDepositSlipMemberLinks(
        { bankAllianceId: "alliance-bank", depositAllianceTag: "Roa", commanderName: "Orange Investor" },
        cache,
      ),
      resolveDepositSlipMemberLinks(
        { bankAllianceId: "alliance-bank", depositAllianceTag: "Roa", commanderName: "Blue Investor" },
        cache,
      ),
    ]);

    expect(listAlliancesWithTags).toHaveBeenCalledTimes(1);
    expect(loadRosterMembers).toHaveBeenCalledTimes(1);
    expect(loadRosterMembers).toHaveBeenCalledWith("alliance-roar");
  });

  it("caches roster fetches per distinct alliance id, not globally", async () => {
    const loadRosterMembers = vi
      .fn()
      .mockImplementation((allianceId: string) =>
        Promise.resolve(
          allianceId === "alliance-a"
            ? [members[0]!]
            : [members[1]!],
        ),
      );

    const cache = createDepositSlipMemberResolverCache({
      listAlliancesByTag: vi.fn(),
      listAlliancesWithTags: vi.fn().mockResolvedValue([
        { id: "alliance-a", tag: "A", name: "A", ownerAshedUserId: null },
        { id: "alliance-b", tag: "B", name: "B", ownerAshedUserId: null },
      ]),
      loadRosterMembers,
      findAllianceMemberId: vi.fn().mockResolvedValue(null),
      resolveCommanderId: vi.fn().mockResolvedValue(null),
    });

    await resolveDepositSlipMemberLinks(
      { bankAllianceId: "alliance-a", depositAllianceTag: null, commanderName: "Blue Investor" },
      cache,
    );
    await resolveDepositSlipMemberLinks(
      { bankAllianceId: "alliance-b", depositAllianceTag: null, commanderName: "Orange Investor" },
      cache,
    );
    await resolveDepositSlipMemberLinks(
      { bankAllianceId: "alliance-a", depositAllianceTag: null, commanderName: "Blue Investor" },
      cache,
    );

    expect(loadRosterMembers).toHaveBeenCalledTimes(2);
    expect(loadRosterMembers).toHaveBeenCalledWith("alliance-a");
    expect(loadRosterMembers).toHaveBeenCalledWith("alliance-b");
  });
});
