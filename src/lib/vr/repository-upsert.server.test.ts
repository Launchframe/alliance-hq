import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

vi.mock("@/lib/activity/monitoring.server", () => ({
  scheduleActivityBlockedAlert: vi.fn(),
}));

import { ActivityWriteError } from "@/lib/activity/errors.server";
import { scheduleActivityBlockedAlert } from "@/lib/activity/monitoring.server";
import { upsertDiscordHqLink } from "@/lib/vr/repository";

const alertMock = vi.mocked(scheduleActivityBlockedAlert);

function fakeTx(linkRows: { hqUserId: string }[]) {
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
  }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateWhere = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  const selectFor = vi.fn().mockResolvedValue(linkRows);
  const where = vi.fn(() => ({ for: selectFor }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const execute = vi.fn().mockResolvedValue([]);
  return { execute, insert, insertValues, select, update, set, updateWhere };
}

function installDb(tx: ReturnType<typeof fakeTx>, state: { rolledBack: boolean }) {
  const transaction = vi.fn(
    async (work: (inner: typeof tx) => Promise<unknown>) => {
      try {
        return await work(tx);
      } catch (error) {
        state.rolledBack = true;
        throw error;
      }
    },
  );
  vi.spyOn(dbModule, "getDb").mockReturnValue({ transaction } as never);
  return transaction;
}

describe("upsertDiscordHqLink activity ownership wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds the link and claims unowned events in one transaction", async () => {
    const tx = fakeTx([{ hqUserId: "hq-1" }]);
    installDb(tx, { rolledBack: false });

    await upsertDiscordHqLink({ discordUserId: "d-1", hqUserId: "hq-1" });

    expect(tx.execute).toHaveBeenCalledTimes(4);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("converts a claim mismatch into an activity write error after rollback", async () => {
    const state = { rolledBack: false };
    const tx = fakeTx([{ hqUserId: "hq-other" }]);
    installDb(tx, state);
    const alertSawRollback: boolean[] = [];
    alertMock.mockImplementation(() => {
      alertSawRollback.push(state.rolledBack);
    });

    const error = await upsertDiscordHqLink({
      discordUserId: "d-1",
      hqUserId: "hq-1",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActivityWriteError);
    expect(state.rolledBack).toBe(true);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe(error);
    expect(alertSawRollback).toEqual([true]);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects invalid ids before any transaction work", async () => {
    const state = { rolledBack: false };
    const tx = fakeTx([]);
    installDb(tx, state);

    await expect(
      upsertDiscordHqLink({ discordUserId: "", hqUserId: "hq-1" }),
    ).rejects.toThrow("activity_identifier_invalid");
    expect(alertMock).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
