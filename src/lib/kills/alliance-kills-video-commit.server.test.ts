import { beforeEach, describe, expect, it, vi } from "vitest";

const getCommanderIdForMember = vi.hoisted(() => vi.fn());
const upsertCommanderKills = vi.hoisted(() => vi.fn());
const revertLatestVideoParseKillsIfStillCurrent = vi.hoisted(() => vi.fn());
const listAllianceDataBatches = vi.hoisted(() => vi.fn());
const selectParsedRows = vi.hoisted(() => vi.fn());

vi.mock("@/lib/kills/repository", () => ({
  getCommanderIdForMember,
  upsertCommanderKills,
  revertLatestVideoParseKillsIfStillCurrent,
}));

vi.mock("@/lib/data-management/batch-ledger.server", () => ({
  listAllianceDataBatches,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: selectParsedRows,
      }),
    }),
  }),
  schema: {
    parsedRows: {
      memberId: "memberId",
      score: "score",
      parseSessionId: "parseSessionId",
      deleted: "deleted",
    },
  },
}));

import {
  commitAllianceKillsFromVideoSubmit,
  listLaterAllianceKillsVideoMemberIds,
  listPriorAllianceKillsVideoMemberIds,
  listPriorAllianceKillsVideoMembers,
} from "@/lib/kills/alliance-kills-video-commit.server";

describe("commitAllianceKillsFromVideoSubmit", () => {
  beforeEach(() => {
    getCommanderIdForMember.mockReset();
    upsertCommanderKills.mockReset();
    revertLatestVideoParseKillsIfStillCurrent.mockReset();
    listAllianceDataBatches.mockReset();
    selectParsedRows.mockReset();
  });

  it("upserts HQ commander kills for linked members and marks Ashed synced", async () => {
    getCommanderIdForMember.mockResolvedValueOnce("cmd-1");
    upsertCommanderKills.mockResolvedValueOnce(true);

    const result = await commitAllianceKillsFromVideoSubmit({
      allianceId: "hq-a1",
      hqUserId: "user-1",
      rows: [
        { memberId: "m1", memberName: "Alice", score: "12,345" },
        { memberId: "m2", memberName: "Bob", score: "bad" },
      ],
    });

    expect(upsertCommanderKills).toHaveBeenCalledWith({
      commanderId: "cmd-1",
      total: 12345,
      allianceId: "hq-a1",
      ashedMemberId: "m1",
      memberName: "Alice",
      source: "video_parse",
      hqUserId: "user-1",
      markAshedSynced: true,
    });
    expect(getCommanderIdForMember).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      updated: 1,
      unchanged: 0,
      skippedUnlinked: 0,
      skippedInvalid: 1,
      reverted: 0,
    });
  });

  it("skips members without a linked commander", async () => {
    getCommanderIdForMember.mockResolvedValueOnce(null);

    const result = await commitAllianceKillsFromVideoSubmit({
      allianceId: "hq-a1",
      rows: [{ memberId: "m1", memberName: "Alice", score: "100" }],
    });

    expect(upsertCommanderKills).not.toHaveBeenCalled();
    expect(result.skippedUnlinked).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("reverts HQ kills for members removed on same-date re-submit", async () => {
    getCommanderIdForMember
      .mockResolvedValueOnce("cmd-kept")
      .mockResolvedValueOnce("cmd-removed");
    upsertCommanderKills.mockResolvedValueOnce(true);
    listAllianceDataBatches.mockResolvedValueOnce([]);
    revertLatestVideoParseKillsIfStillCurrent.mockResolvedValueOnce(true);

    const result = await commitAllianceKillsFromVideoSubmit({
      allianceId: "hq-a1",
      recordedDate: "2026-07-18",
      previousMembers: [
        { memberId: "m-kept", score: "100" },
        { memberId: "m-removed", score: "2500" },
      ],
      rows: [{ memberId: "m-kept", memberName: "Kept", score: "100" }],
    });

    expect(revertLatestVideoParseKillsIfStillCurrent).toHaveBeenCalledWith(
      "cmd-removed",
      2500,
    );
    expect(result.reverted).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("does not revert members still present on a later KillScore date", async () => {
    getCommanderIdForMember.mockResolvedValueOnce("cmd-kept");
    upsertCommanderKills.mockResolvedValueOnce(true);
    listAllianceDataBatches.mockResolvedValueOnce([
      {
        recordedDate: "2026-07-19",
        contextJson: {},
        parseSessionId: "ps-later",
      },
    ]);
    selectParsedRows.mockResolvedValueOnce([
      { memberId: "m-removed", score: "3000" },
    ]);

    const result = await commitAllianceKillsFromVideoSubmit({
      allianceId: "hq-a1",
      recordedDate: "2026-07-18",
      previousMembers: [
        { memberId: "m-kept", score: "100" },
        { memberId: "m-removed", score: "2500" },
      ],
      rows: [{ memberId: "m-kept", memberName: "Kept", score: "100" }],
    });

    expect(revertLatestVideoParseKillsIfStillCurrent).not.toHaveBeenCalled();
    expect(result.reverted).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("passes prior-batch expected total so a newer event is not discarded", async () => {
    getCommanderIdForMember
      .mockResolvedValueOnce("cmd-kept")
      .mockResolvedValueOnce("cmd-removed");
    upsertCommanderKills.mockResolvedValueOnce(true);
    listAllianceDataBatches.mockResolvedValueOnce([]);
    revertLatestVideoParseKillsIfStillCurrent.mockResolvedValueOnce(false);

    await commitAllianceKillsFromVideoSubmit({
      allianceId: "hq-a1",
      recordedDate: "2026-07-18",
      previousMembers: [
        { memberId: "m-kept", score: "100" },
        { memberId: "m-removed", score: "2,500" },
      ],
      rows: [{ memberId: "m-kept", memberName: "Kept", score: "100" }],
    });

    expect(revertLatestVideoParseKillsIfStillCurrent).toHaveBeenCalledWith(
      "cmd-removed",
      2500,
    );
  });
});

describe("listPriorAllianceKillsVideoMembers", () => {
  beforeEach(() => {
    listAllianceDataBatches.mockReset();
    selectParsedRows.mockReset();
  });

  it("collects member ids and scores from active batches for the recorded date", async () => {
    listAllianceDataBatches.mockResolvedValueOnce([
      {
        recordedDate: "2026-07-18",
        contextJson: {},
        parseSessionId: "ps-1",
      },
      {
        recordedDate: "2026-07-17",
        contextJson: {},
        parseSessionId: "ps-old",
      },
    ]);
    selectParsedRows.mockResolvedValueOnce([
      { memberId: "m1", score: "1000" },
      { memberId: "m2", score: "2000" },
    ]);

    const members = await listPriorAllianceKillsVideoMembers({
      allianceId: "hq-a1",
      recordedDate: "2026-07-18",
    });

    expect(members).toEqual([
      { memberId: "m1", score: "1000" },
      { memberId: "m2", score: "2000" },
    ]);
    expect(members.map((member) => member.memberId)).toEqual(["m1", "m2"]);
  });

  it("listPriorAllianceKillsVideoMemberIds returns member ids only", async () => {
    listAllianceDataBatches.mockResolvedValueOnce([
      {
        recordedDate: "2026-07-18",
        contextJson: {},
        parseSessionId: "ps-1",
      },
    ]);
    selectParsedRows.mockResolvedValueOnce([
      { memberId: "m1", score: "1000" },
      { memberId: "m2", score: "2000" },
    ]);

    await expect(
      listPriorAllianceKillsVideoMemberIds({
        allianceId: "hq-a1",
        recordedDate: "2026-07-18",
      }),
    ).resolves.toEqual(["m1", "m2"]);
  });
});

describe("listLaterAllianceKillsVideoMemberIds", () => {
  beforeEach(() => {
    listAllianceDataBatches.mockReset();
    selectParsedRows.mockReset();
  });

  it("collects members from active batches after the recorded date", async () => {
    listAllianceDataBatches.mockResolvedValueOnce([
      {
        recordedDate: "2026-07-19",
        contextJson: {},
        parseSessionId: "ps-later",
      },
      {
        recordedDate: "2026-07-18",
        contextJson: {},
        parseSessionId: "ps-same",
      },
    ]);
    selectParsedRows.mockResolvedValueOnce([{ memberId: "m-later", score: "9" }]);

    const ids = await listLaterAllianceKillsVideoMemberIds({
      allianceId: "hq-a1",
      recordedDate: "2026-07-18",
    });

    expect([...ids]).toEqual(["m-later"]);
  });
});
