import { describe, expect, it, vi } from "vitest";

import {
  DEPOSIT_SLIP_MEMBER_AUTO_LINK_MIN,
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
    expect(pickUniqueFuzzyAllianceTag("Roa", candidates)?.id).toBe(
      "alliance-roar",
    );
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
  it("resolves a unique tag and exact commander name into all three FKs", async () => {
    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roar",
        commanderName: "Blue Investor",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([
          { id: "alliance-roar", tag: "Roar", name: "Roar", ownerAshedUserId: null },
        ]),
        loadRosterMembers: vi.fn().mockResolvedValue(members),
        findAllianceMemberId: vi.fn().mockResolvedValue("am-blue"),
        resolveCommanderId: vi.fn().mockResolvedValue("cmd-blue"),
      },
    );

    expect(result).toMatchObject({
      depositAllianceId: "alliance-roar",
      allianceMemberId: "am-blue",
      commanderId: "cmd-blue",
      ashedMemberId: "ashed-blue",
      matchMethod: "exact",
      matchConfidence: 1,
      candidateAshedMemberId: "ashed-blue",
      candidateMemberName: "Blue Investor",
      tagMatchMethod: "exact",
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
    expect(result.tagMatchMethod).toBe("fuzzy");
    expect(result.allianceMemberId).toBe("am-blue");
    expect(result.matchMethod).toBe("exact");
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
        loadRosterMembers,
        findAllianceMemberId,
        resolveCommanderId,
      },
    );

    expect(result.depositAllianceId).toBeNull();
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
        listAlliancesByTag: vi.fn().mockResolvedValue([
          { id: "alliance-roar", tag: "Roar", name: "Roar", ownerAshedUserId: null },
        ]),
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

  it("returns null member FKs when the commander name does not match", async () => {
    const result = await resolveDepositSlipMemberLinks(
      {
        bankAllianceId: "alliance-bank",
        depositAllianceTag: "Roar",
        commanderName: "Completely Unknown",
      },
      {
        listAlliancesByTag: vi.fn().mockResolvedValue([
          { id: "alliance-roar", tag: "Roar", name: "Roar", ownerAshedUserId: null },
        ]),
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
