import { describe, expect, it, vi } from "vitest";

import { resolveDepositSlipMemberLinks } from "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server";
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

    expect(result).toEqual({
      depositAllianceId: "alliance-roar",
      allianceMemberId: "am-blue",
      commanderId: "cmd-blue",
      ashedMemberId: "ashed-blue",
      matchMethod: "exact",
      matchConfidence: 1,
    });
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

    expect(result).toEqual({
      depositAllianceId: "alliance-roar",
      allianceMemberId: null,
      commanderId: null,
      ashedMemberId: null,
      matchMethod: "none",
      matchConfidence: 0,
    });
  });
});
