import { beforeEach, describe, expect, it, vi } from "vitest";

const createDepositSlip = vi.hoisted(() => vi.fn());
const selectLimit = vi.hoisted(() => vi.fn());
const selectWhereRows = vi.hoisted(() => vi.fn());
const resolveDepositSlipMemberLinks = vi.hoisted(() => vi.fn());
const createDepositSlipMemberResolverCache = vi.hoisted(() => vi.fn());

vi.mock("@/lib/banks/repository.server", () => ({
  createDepositSlip,
}));

vi.mock(
  "@/lib/banks/deposit-slip-ocr/resolve-deposit-slip-member.server",
  () => ({
    resolveDepositSlipMemberLinks,
    createDepositSlipMemberResolverCache,
  }),
);

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          const linkMeta = Promise.resolve(selectWhereRows());
          return Object.assign(linkMeta, { limit: selectLimit });
        },
      }),
    }),
  }),
  schema: {
    banks: { id: "banks.id", allianceId: "banks.allianceId" },
    parsedRows: {
      id: "parsedRows.id",
      memberId: "parsedRows.memberId",
      matchMethod: "parsedRows.matchMethod",
      parseSessionId: "parsedRows.parseSessionId",
      deleted: "parsedRows.deleted",
    },
  },
}));

import { commitDepositSlipsFromVideoJob } from "@/lib/banks/deposit-slip-ocr/deposit-slip-video-commit.server";

describe("commitDepositSlipsFromVideoJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([{ id: "bank-1" }]);
    selectWhereRows.mockReturnValue([]);
    createDepositSlip.mockResolvedValue({ id: "slip-1" });
    createDepositSlipMemberResolverCache.mockReturnValue({});
    resolveDepositSlipMemberLinks.mockResolvedValue({
      depositAllianceId: "alliance-roar",
      allianceMemberId: "am-1",
      commanderId: "cmd-1",
      ashedMemberId: "ashed-1",
      matchMethod: "exact",
      matchConfidence: 1,
      candidateAshedMemberId: "ashed-1",
      candidateMemberName: "Blue Investor",
      candidateMatchMethod: "exact",
      candidateConfidence: 1,
      tagMatchMethod: "exact",
      tagMatchConfidence: 1,
    });
  });

  it("rejects when the bank is not in the job alliance", async () => {
    selectLimit.mockResolvedValue([]);

    await expect(
      commitDepositSlipsFromVideoJob({
        allianceId: "alliance-a",
        bankId: "bank-other",
        parseSessionId: "parse-1",
        rows: [
          {
            id: "row-1",
            ocrName: "Investor",
            score: "6000",
            powerLevel: "2026-07-10T12:14:34.000Z",
            memberLevel: 3,
            profession: "locked",
            allianceRankTitle: "Roar",
            rosterRankRaw: null,
            frameIndex: 0,
            deleted: false,
          },
        ],
      }),
    ).rejects.toThrow("Bank not found.");
  });

  it("creates locked and looted slips with resolved member FKs", async () => {
    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-locked",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:14:34.000Z",
          memberLevel: 3,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 0,
          deleted: false,
        },
        {
          id: "row-looted",
          ocrName: "Orange Investor",
          score: "6000",
          powerLevel: "2026-07-09T12:49:35.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          frameIndex: 1,
          deleted: false,
        },
      ],
    });

    expect(result.createdCount).toBe(2);
    expect(createDepositSlipMemberResolverCache).toHaveBeenCalledTimes(1);
    expect(resolveDepositSlipMemberLinks).toHaveBeenCalledTimes(2);
    expect(resolveDepositSlipMemberLinks).toHaveBeenNthCalledWith(
      1,
      {
        bankAllianceId: "alliance-a",
        depositAllianceTag: "Roar",
        commanderName: "Blue Investor",
        preferredAshedMemberId: null,
      },
      createDepositSlipMemberResolverCache.mock.results[0]!.value,
    );
    expect(createDepositSlip).toHaveBeenCalledTimes(2);
    expect(createDepositSlip).toHaveBeenNthCalledWith(1, "alliance-a", {
      bankId: "bank-1",
      depositAt: "2026-07-10T12:14:34.000Z",
      termDays: 3,
      amount: 6000,
      outcomeAmount: null,
      status: "locked",
      outcomeAt: null,
      depositAllianceTag: "Roar",
      depositAllianceId: "alliance-roar",
      commanderName: "Blue Investor",
      commanderId: "cmd-1",
      allianceMemberId: "am-1",
    });
    expect(createDepositSlip).toHaveBeenNthCalledWith(2, "alliance-a", {
      bankId: "bank-1",
      depositAt: "2026-07-09T12:49:35.000Z",
      termDays: 3,
      amount: 6000,
      outcomeAmount: null,
      status: "looted",
      outcomeAt: "2026-07-09T12:49:35.000Z",
      depositAllianceTag: "Roar",
      depositAllianceId: "alliance-roar",
      commanderName: "Orange Investor",
      commanderId: "cmd-1",
      allianceMemberId: "am-1",
    });
  });

  it("prefers parse-time auto-linked memberId over name rematch", async () => {
    selectWhereRows.mockReturnValue([
      {
        id: "row-locked",
        memberId: "ashed-preferred",
        matchMethod: "exact",
      },
    ]);

    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-locked",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:14:34.000Z",
          memberLevel: 3,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(resolveDepositSlipMemberLinks).toHaveBeenCalledWith(
      {
        bankAllianceId: "alliance-a",
        depositAllianceTag: "Roar",
        commanderName: "Blue Investor",
        preferredAshedMemberId: "ashed-preferred",
      },
      expect.anything(),
    );
  });

  it("does not prefer near-miss candidate memberIds (matchMethod none)", async () => {
    selectWhereRows.mockReturnValue([
      {
        id: "row-locked",
        memberId: "ashed-near",
        matchMethod: "none",
      },
    ]);

    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-locked",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:14:34.000Z",
          memberLevel: 3,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(resolveDepositSlipMemberLinks).toHaveBeenCalledWith(
      expect.objectContaining({ preferredAshedMemberId: null }),
      expect.anything(),
    );
  });

  it("skips deleted and incomplete rows then throws when nothing valid remains", async () => {
    await expect(
      commitDepositSlipsFromVideoJob({
        allianceId: "alliance-a",
        bankId: "bank-1",
        parseSessionId: "parse-1",
        rows: [
          {
            id: "row-deleted",
            ocrName: "Skip Me",
            score: "6000",
            powerLevel: "2026-07-10T12:14:34.000Z",
            memberLevel: 3,
            profession: "locked",
            allianceRankTitle: null,
            rosterRankRaw: null,
            frameIndex: null,
            deleted: true,
          },
          {
            id: "row-incomplete",
            ocrName: "",
            score: "6000",
            powerLevel: "2026-07-10T12:14:34.000Z",
            memberLevel: 3,
            profession: "locked",
            allianceRankTitle: null,
            rosterRankRaw: null,
            frameIndex: null,
            deleted: false,
          },
        ],
      }),
    ).rejects.toThrow("Row row-incomplete: missing commander");
    expect(createDepositSlip).not.toHaveBeenCalled();
    expect(resolveDepositSlipMemberLinks).not.toHaveBeenCalled();
  });

  it("reports skipped rows while committing valid ones", async () => {
    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-valid",
          ocrName: "Valid Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:14:34.000Z",
          memberLevel: 1,
          profession: "matured",
          allianceRankTitle: "Roar",
          rosterRankRaw: "total_return",
          frameIndex: 0,
          deleted: false,
        },
        {
          id: "row-incomplete",
          ocrName: "Missing Term",
          score: "6000",
          powerLevel: "2026-07-10T11:00:00.000Z",
          memberLevel: null,
          profession: "locked",
          allianceRankTitle: null,
          rosterRankRaw: null,
          frameIndex: 1,
          deleted: false,
        },
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(createDepositSlip).toHaveBeenCalledTimes(1);
  });
});
