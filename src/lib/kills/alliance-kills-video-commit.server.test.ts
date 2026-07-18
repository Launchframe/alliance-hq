import { beforeEach, describe, expect, it, vi } from "vitest";

const getCommanderIdForMember = vi.hoisted(() => vi.fn());
const upsertCommanderKills = vi.hoisted(() => vi.fn());

vi.mock("@/lib/kills/repository", () => ({
  getCommanderIdForMember,
  upsertCommanderKills,
}));

import { commitAllianceKillsFromVideoSubmit } from "@/lib/kills/alliance-kills-video-commit.server";

describe("commitAllianceKillsFromVideoSubmit", () => {
  beforeEach(() => {
    getCommanderIdForMember.mockReset();
    upsertCommanderKills.mockReset();
  });

  it("upserts HQ commander kills for linked members", async () => {
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
    });
    expect(getCommanderIdForMember).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      updated: 1,
      unchanged: 0,
      skippedUnlinked: 0,
      skippedInvalid: 1,
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
});
