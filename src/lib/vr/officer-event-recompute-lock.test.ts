import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Officer PATCH/DELETE on season VR history used to mutate an event then
 * recompute `commander_season_vr` without holding the commander / season-row
 * locks that `upsertCommanderSeasonVr` uses. A concurrent self-submit could
 * insert a higher event + summary between the officer's event list read and
 * the blind summary overwrite — leaving the leaderboard high below event
 * history.
 *
 * These tests lock the serialization contract: mutate+recompute run inside
 * one transaction after `FOR UPDATE` on commanders (and the season row).
 */

vi.mock("@/lib/activity/monitoring.server", () => ({
  scheduleActivityBlockedAlert: vi.fn(),
}));

import * as dbModule from "@/lib/db";
import {
  deleteCommanderSeasonVrEvent,
  updateCommanderSeasonVrEvent,
} from "@/lib/vr/repository";

const eventRow = {
  id: "evt-1",
  commanderId: "cmd-1",
  seasonKey: "5",
  baseVr: 200,
  instituteLevel: 30,
  previousBaseVr: null,
  source: "hq" as const,
  allianceId: "ally-1",
  reportedByHqUserId: "hq-1",
  reportedByDiscordUserId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const remainingEvent = {
  ...eventRow,
  id: "evt-0",
  baseVr: 100,
  createdAt: new Date("2025-12-01T00:00:00.000Z"),
};

function installOfficerTxMock(mode: "delete" | "update") {
  const order: string[] = [];
  let selectCall = 0;

  const forUpdate = (label: string, rows: unknown[]) =>
    vi.fn(async () => {
      order.push(`${label}:forUpdate`);
      return rows;
    });

  const tx = {
    select: vi.fn(() => {
      selectCall += 1;
      const n = selectCall;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (n === 1) {
              return {
                limit: vi.fn(() =>
                  Promise.resolve([eventRow]).then((rows) => {
                    order.push("event:select");
                    return rows;
                  }),
                ),
              };
            }
            if (n === 2) {
              return {
                limit: vi.fn(() =>
                  Promise.resolve([{ ashedMemberId: "m1" }]).then((rows) => {
                    order.push("membership:select");
                    return rows;
                  }),
                ),
              };
            }
            if (n === 3) {
              return {
                limit: vi.fn(() => ({
                  for: forUpdate("commander", [{ id: "cmd-1" }]),
                })),
              };
            }
            if (n === 4) {
              return {
                limit: vi.fn(() => ({
                  for: forUpdate("season", [{ highestBaseVr: 200 }]),
                })),
              };
            }
            return {
              orderBy: vi.fn(async () => {
                order.push("events:select");
                return [remainingEvent];
              }),
            };
          }),
        })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          order.push("event:update");
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => {
      void table;
      return {
        where: vi.fn(async () => {
          // First delete is the event row; later delete is empty-summary path.
          if (!order.includes("event:delete") && mode === "delete") {
            order.push("event:delete");
          } else {
            order.push("summary:delete");
          }
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => {
          order.push("summary:upsert");
        }),
      })),
    })),
  };

  const transaction = vi.fn(async (work: (inner: typeof tx) => Promise<unknown>) => {
    order.push("transaction:enter");
    selectCall = 0;
    const result = await work(tx);
    order.push("transaction:exit");
    return result;
  });

  vi.spyOn(dbModule, "getDb").mockReturnValue({
    transaction,
    select: () => {
      throw new Error("officer mutate must use the transaction client");
    },
    update: () => {
      throw new Error("officer mutate must use the transaction client");
    },
    delete: () => {
      throw new Error("officer mutate must use the transaction client");
    },
  } as never);

  return { order, transaction, tx };
}

describe("officer season VR event mutate + recompute locking", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("delete: locks commander+season inside one TX before mutating and recomputing", async () => {
    const { order } = installOfficerTxMock("delete");

    const result = await deleteCommanderSeasonVrEvent({
      eventId: "evt-1",
      allianceId: "ally-1",
      hqUserId: "hq-1",
    });

    expect(result).toEqual({ ok: true });
    expect(order).toEqual([
      "transaction:enter",
      "event:select",
      "membership:select",
      "commander:forUpdate",
      "season:forUpdate",
      "event:delete",
      "events:select",
      "summary:upsert",
      "transaction:exit",
    ]);

    const commanderLock = order.indexOf("commander:forUpdate");
    const deleteIdx = order.indexOf("event:delete");
    const eventsIdx = order.indexOf("events:select");
    const upsertIdx = order.indexOf("summary:upsert");
    expect(commanderLock).toBeLessThan(deleteIdx);
    expect(deleteIdx).toBeLessThan(eventsIdx);
    expect(eventsIdx).toBeLessThan(upsertIdx);
  });

  it("update: locks commander+season inside one TX before mutating and recomputing", async () => {
    const { order } = installOfficerTxMock("update");

    const result = await updateCommanderSeasonVrEvent({
      eventId: "evt-1",
      allianceId: "ally-1",
      instituteLevel: 28,
      baseVr: 150,
      hqUserId: "hq-1",
    });

    expect(result).toEqual({ ok: true });
    expect(order).toEqual([
      "transaction:enter",
      "event:select",
      "membership:select",
      "commander:forUpdate",
      "season:forUpdate",
      "event:update",
      "events:select",
      "summary:upsert",
      "transaction:exit",
    ]);
  });
});
