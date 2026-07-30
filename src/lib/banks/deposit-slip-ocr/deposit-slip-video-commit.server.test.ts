import { beforeEach, describe, expect, it, vi } from "vitest";

const createDepositSlip = vi.hoisted(() => vi.fn());
const updateDepositSlip = vi.hoisted(() => vi.fn());
const listDepositSlipsForBank = vi.hoisted(() => vi.fn());
const selectLimit = vi.hoisted(() => vi.fn());
const selectWhereRows = vi.hoisted(() => vi.fn());
const resolveDepositSlipMemberLinks = vi.hoisted(() => vi.fn());
const createDepositSlipMemberResolverCache = vi.hoisted(() => vi.fn());
const withBankDepositCommitLock = vi.hoisted(() =>
  vi.fn(async (_key: unknown, run: () => Promise<unknown>) => run()),
);

vi.mock("@/lib/banks/repository.server", () => ({
  createDepositSlip,
  updateDepositSlip,
  listDepositSlipsForBank,
}));

vi.mock("@/lib/banks/bank-deposit-commit-lock.server", () => ({
  withBankDepositCommitLock,
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
      rank: "parsedRows.rank",
      parseSessionId: "parsedRows.parseSessionId",
      deleted: "parsedRows.deleted",
    },
  },
}));

import { commitDepositSlipsFromVideoJob } from "@/lib/banks/deposit-slip-ocr/deposit-slip-video-commit.server";

describe("commitDepositSlipsFromVideoJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withBankDepositCommitLock.mockImplementation(
      async (_key: unknown, run: () => Promise<unknown>) => run(),
    );
    selectLimit.mockResolvedValue([{ id: "bank-1" }]);
    selectWhereRows.mockReturnValue([]);
    listDepositSlipsForBank.mockResolvedValue([]);
    createDepositSlip.mockResolvedValue({ id: "slip-1" });
    updateDepositSlip.mockResolvedValue({ id: "slip-1" });
    createDepositSlipMemberResolverCache.mockReturnValue({});
    resolveDepositSlipMemberLinks.mockImplementation(async (input) => {
      const linked =
        Boolean(input.preferredAshedMemberId) ||
        Boolean(input.commanderName?.trim());
      const rosterName =
        input.commanderName === "Bania QC"
          ? "Banla QC"
          : input.commanderName;
      return {
        depositAllianceId: "alliance-roar",
        rosterAllianceId: "alliance-roar",
        resolvedAllianceTag: "Roar",
        allianceMemberId: linked
          ? input.preferredAshedMemberId === "ashed-bania"
            ? "am-bania"
            : "am-1"
          : null,
        commanderId: linked ? "cmd-1" : null,
        ashedMemberId: input.preferredAshedMemberId,
        matchMethod: linked
          ? input.commanderName === "Bania QC"
            ? "fuzzy"
            : "exact"
          : "none",
        matchConfidence: linked ? 1 : 0,
        candidateAshedMemberId: input.preferredAshedMemberId,
        candidateMemberName: rosterName,
        candidateMatchMethod: linked ? "exact" : "none",
        candidateConfidence: linked ? 1 : 0,
        tagMatchMethod: "exact",
        tagMatchConfidence: 1,
      };
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
    expect(withBankDepositCommitLock).not.toHaveBeenCalled();
  });

  it("serializes history load and create under the bank deposit commit lock", async () => {
    const order: string[] = [];
    withBankDepositCommitLock.mockImplementation(
      async (key: unknown, run: () => Promise<unknown>) => {
        const typed = key as { allianceId: string; bankId: string };
        order.push(`lock:${typed.allianceId}:${typed.bankId}`);
        return run();
      },
    );
    listDepositSlipsForBank.mockImplementation(async () => {
      order.push("list");
      return [];
    });
    createDepositSlip.mockImplementation(async () => {
      order.push("create");
      return { id: "slip-1" };
    });

    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-1",
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

    expect(withBankDepositCommitLock).toHaveBeenCalledWith(
      { allianceId: "alliance-a", bankId: "bank-1" },
      expect.any(Function),
    );
    expect(order).toEqual([
      "lock:alliance-a:bank-1",
      "list",
      "create",
    ]);
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

  it("persists outcomeAmount from rank on matured/looted rows", async () => {
    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-matured",
          ocrName: "Green Investor",
          score: "5000",
          powerLevel: "2026-07-10T12:14:34.000Z",
          memberLevel: 3,
          profession: "matured",
          allianceRankTitle: "Roar",
          rosterRankRaw: "total_return",
          rank: 5750,
          frameIndex: 0,
          deleted: false,
        },
        {
          id: "row-looted",
          ocrName: "Orange Investor",
          score: "5000",
          powerLevel: "2026-07-09T12:49:35.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          rank: 3000,
          frameIndex: 1,
          deleted: false,
        },
      ],
    });

    expect(createDepositSlip).toHaveBeenNthCalledWith(1, "alliance-a", {
      bankId: "bank-1",
      depositAt: "2026-07-10T12:14:34.000Z",
      termDays: 3,
      amount: 5000,
      outcomeAmount: 5750,
      status: "matured",
      outcomeAt: "2026-07-10T12:14:34.000Z",
      depositAllianceTag: "Roar",
      depositAllianceId: "alliance-roar",
      commanderName: "Green Investor",
      commanderId: "cmd-1",
      allianceMemberId: "am-1",
    });
    expect(createDepositSlip).toHaveBeenNthCalledWith(2, "alliance-a", {
      bankId: "bank-1",
      depositAt: "2026-07-09T12:49:35.000Z",
      termDays: 3,
      amount: 5000,
      outcomeAmount: 3000,
      status: "looted",
      outcomeAt: "2026-07-09T12:49:35.000Z",
      depositAllianceTag: "Roar",
      depositAllianceId: "alliance-roar",
      commanderName: "Orange Investor",
      commanderId: "cmd-1",
      allianceMemberId: "am-1",
    });
  });

  it("persists lifecycle-merge outcomeAt from rosterRankRaw @suffix on create", async () => {
    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-lifecycle",
          ocrName: "Lifecycle Investor",
          score: "5000",
          powerLevel: "2026-07-10T12:00:00.000Z",
          memberLevel: 1,
          profession: "matured",
          allianceRankTitle: "Roar",
          rosterRankRaw: "total_return@2026-07-11T14:30:00.000Z",
          rank: 5700,
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(createDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      expect.objectContaining({
        depositAt: "2026-07-10T12:00:00.000Z",
        status: "matured",
        outcomeAt: "2026-07-11T14:30:00.000Z",
        outcomeAmount: 5700,
      }),
    );
  });

  it("hydrates outcomeAmount from parsed_rows when submit omits rank", async () => {
    selectWhereRows.mockReturnValue([
      {
        id: "row-matured",
        memberId: null,
        matchMethod: null,
        rank: 6840,
      },
    ]);

    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-matured",
          ocrName: "Green Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:14:34.000Z",
          memberLevel: 3,
          profession: "matured",
          allianceRankTitle: "Roar",
          rosterRankRaw: "total_return",
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(createDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      expect.objectContaining({
        amount: 6000,
        outcomeAmount: 6840,
        status: "matured",
      }),
    );
  });

  it("skips high-confidence duplicates already stored for the bank", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-1",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-10T12:14:34.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-dup",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:16:00.000Z",
          memberLevel: 3,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 0,
          deleted: false,
        },
        {
          id: "row-new",
          ocrName: "Fresh Investor",
          score: "6000",
          powerLevel: "2026-07-11T10:00:00.000Z",
          memberLevel: 1,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 1,
          deleted: false,
        },
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(createDepositSlip).toHaveBeenCalledTimes(1);
    expect(createDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      expect.objectContaining({ commanderName: "Fresh Investor" }),
    );
    expect(updateDepositSlip).not.toHaveBeenCalled();
  });

  it("succeeds when every valid row was already in history", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-1",
        commanderName: "Blue Investor",
        depositAt: "2026-07-10T12:14:34.000Z",
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-dup",
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

    expect(result.createdCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(createDepositSlip).not.toHaveBeenCalled();
  });

  it("updates a locked history slip when a nearby looted OCR row arrives", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-locked",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-10T12:14:34.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-loot",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:20:00.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          rank: 3000,
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(result.createdCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(createDepositSlip).not.toHaveBeenCalled();
    expect(updateDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      "hist-locked",
      expect.objectContaining({
        depositAt: "2026-07-10T12:14:34.000Z",
        status: "looted",
        outcomeAt: "2026-07-10T12:20:00.000Z",
        outcomeAmount: 3000,
      }),
    );
  });

  it("does not double-update when the same terminal OCR row repeats within one batch", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-locked",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-10T12:14:34.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-loot-1",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:20:00.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          rank: 3000,
          frameIndex: 0,
          deleted: false,
        },
        {
          id: "row-loot-2",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-10T12:20:05.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          rank: 3000,
          frameIndex: 1,
          deleted: false,
        },
      ],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(updateDepositSlip).toHaveBeenCalledTimes(1);
  });

  it("does not double-insert when a repeated terminal row lands >15m from the initiate but near the just-applied outcome", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-locked",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-10T12:14:34.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-loot-1",
          ocrName: "Blue Investor",
          score: "6000",
          // ~5m26s after initiate — matches the locked slip via lifecycle timing.
          powerLevel: "2026-07-10T12:20:00.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          rank: 3000,
          frameIndex: 0,
          deleted: false,
        },
        {
          id: "row-loot-2",
          ocrName: "Blue Investor",
          score: "6000",
          // ~19m26s after initiate (outside DEPOSIT_AT_PROXIMITY_MS from the
          // locked initiate) but only 14m after row-loot-1's outcome — a
          // second OCR read of the same terminal event, not a new deposit.
          powerLevel: "2026-07-10T12:34:00.000Z",
          memberLevel: 3,
          profession: "looted",
          allianceRankTitle: "Roar",
          rosterRankRaw: "early_termination_refund",
          rank: 3000,
          frameIndex: 1,
          deleted: false,
        },
      ],
    });

    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(createDepositSlip).not.toHaveBeenCalled();
    expect(updateDepositSlip).toHaveBeenCalledTimes(1);
  });

  it("updates a locked slip from a day-later matured-only OCR upload", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-locked",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-10T12:14:34.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-matured",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-13T12:14:34.000Z",
          memberLevel: 3,
          profession: "matured",
          allianceRankTitle: "Roar",
          rosterRankRaw: "total_return",
          rank: 6900,
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(result.createdCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(createDepositSlip).not.toHaveBeenCalled();
    expect(updateDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      "hist-locked",
      expect.objectContaining({
        depositAt: "2026-07-10T12:14:34.000Z",
        status: "matured",
        outcomeAt: "2026-07-13T12:14:34.000Z",
        outcomeAmount: 6900,
      }),
    );
  });

  it("skips re-upload duplicates when stored history shares roster member id", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-banla",
        commanderName: "Banla QC",
        depositAt: new Date("2026-07-28T21:11:22.000Z"),
        amount: 6000,
        termDays: 5,
        depositAllianceTag: "Roar",
        status: "locked",
        allianceMemberId: "am-bania",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-bania",
          ocrName: "Bania QC",
          score: "6000",
          powerLevel: "2026-07-28T21:11:22.000Z",
          memberLevel: 5,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 8,
          deleted: false,
          memberId: "ashed-bania",
          matchMethod: "fuzzy",
        },
      ],
    });

    expect(result.createdCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(createDepositSlip).not.toHaveBeenCalled();
  });

  it("skips OCR name-variant duplicates within one batch when roster member matches", async () => {
    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-banla",
          ocrName: "Banla QC",
          score: "6000",
          powerLevel: "2026-07-28T21:11:22.000Z",
          memberLevel: 5,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 7,
          deleted: false,
          memberId: "ashed-bania",
          matchMethod: "exact",
        },
        {
          id: "row-bania",
          ocrName: "Bania QC",
          score: "6000",
          powerLevel: "2026-07-28T21:11:22.000Z",
          memberLevel: 5,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 8,
          deleted: false,
          memberId: "ashed-bania",
          matchMethod: "fuzzy",
        },
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(createDepositSlip).toHaveBeenCalledTimes(1);
    expect(createDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      expect.objectContaining({
        commanderName: "Banla QC",
        allianceMemberId: "am-bania",
      }),
    );
  });

  it("does not terminate a same-minute re-deposit when closing the prior slip", async () => {
    listDepositSlipsForBank.mockResolvedValue([
      {
        id: "hist-old",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-10T12:14:34.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
      {
        id: "hist-redeposit",
        commanderName: "Blue Investor",
        depositAt: new Date("2026-07-13T12:15:00.000Z"),
        amount: 6000,
        termDays: 3,
        depositAllianceTag: "Roar",
        status: "locked",
      },
    ]);

    const result = await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-matured",
          ocrName: "Blue Investor",
          score: "6000",
          powerLevel: "2026-07-13T12:14:34.000Z",
          memberLevel: 3,
          profession: "matured",
          allianceRankTitle: "Roar",
          rosterRankRaw: "total_return",
          rank: 6900,
          frameIndex: 0,
          deleted: false,
        },
      ],
    });

    expect(result.updatedCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(updateDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      "hist-old",
      expect.objectContaining({ status: "matured" }),
    );
    expect(updateDepositSlip).not.toHaveBeenCalledWith(
      "alliance-a",
      "hist-redeposit",
      expect.anything(),
    );
  });

  it("persists roster canonical commander name for fuzzy auto-linked rows", async () => {
    await commitDepositSlipsFromVideoJob({
      allianceId: "alliance-a",
      bankId: "bank-1",
      parseSessionId: "parse-1",
      rows: [
        {
          id: "row-bania",
          ocrName: "Bania QC",
          score: "6000",
          powerLevel: "2026-07-28T21:11:22.000Z",
          memberLevel: 5,
          profession: "locked",
          allianceRankTitle: "Roar",
          rosterRankRaw: null,
          frameIndex: 8,
          deleted: false,
          memberId: "ashed-bania",
          matchMethod: "fuzzy",
        },
      ],
    });

    expect(createDepositSlip).toHaveBeenCalledWith(
      "alliance-a",
      expect.objectContaining({
        commanderName: "Banla QC",
        allianceMemberId: "am-bania",
      }),
    );
  });
});
