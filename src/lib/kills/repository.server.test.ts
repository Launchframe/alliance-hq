import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const alertMock = vi.fn();
vi.mock("@/lib/activity/monitoring.server", () => ({
  scheduleActivityBlockedAlert: (...args: unknown[]) => alertMock(...args),
}));

import * as schema from "@/lib/db/schema";
import type { ActivityPrincipal } from "@/lib/activity/access.server";
import { ActivityWriteError } from "@/lib/activity/errors.server";
import type { ActivityTransaction } from "@/lib/activity/writer.server";

import {
  KillsPendingChangedError,
  upsertCommanderKills,
} from "./repository";

const dialect = new PgDialect();

type Row = Record<string, unknown>;

type RecordedSelect = {
  table: unknown;
  where: unknown;
  limit: number | null;
  forMode: string | null;
};

let currentTx: ActivityTransaction;
const selects: RecordedSelect[] = [];
const inserts: { table: unknown; values: unknown }[] = [];
const updates: { table: unknown; set: unknown; where: unknown }[] = [];
const deletes: { table: unknown; where: unknown }[] = [];
const executed: unknown[] = [];

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...original,
    getDb: () => ({
      transaction: (work: (tx: ActivityTransaction) => Promise<unknown>) =>
        work(currentTx),
    }),
  };
});

function makeTx(
  rowsByTable: Map<unknown, Row[] | Row[][]> = new Map(),
  options: { failInsertOn?: unknown } = {},
): ActivityTransaction {
  const queues = new Map<unknown, Row[][]>();
  const rowsFor = (table: unknown): Row[] => {
    if (!queues.has(table)) {
      const entry = rowsByTable.get(table) ?? [];
      if (entry.length > 0 && Array.isArray(entry[0])) {
        queues.set(table, entry as Row[][]);
      } else {
        return entry as Row[];
      }
    }
    const queue = queues.get(table) ?? [];
    if (queue.length > 1) {
      return queue.shift() ?? [];
    }
    return queue[0] ?? [];
  };

  const tx = {
    execute: (arg: unknown) => {
      executed.push(arg);
      return Promise.resolve([]);
    },
    select: () => {
      const record: RecordedSelect = {
        table: undefined,
        where: undefined,
        limit: null,
        forMode: null,
      };
      selects.push(record);
      const link = {
        from: (table: unknown) => {
          record.table = table;
          return link;
        },
        innerJoin: () => link,
        leftJoin: () => link,
        where: (cond: unknown) => {
          record.where = cond;
          return link;
        },
        orderBy: () => link,
        limit: (n: number) => {
          record.limit = n;
          return link;
        },
        for: (mode: string) => {
          record.forMode = mode;
          return link;
        },
        then: (
          onFulfilled?: ((rows: Row[]) => unknown) | null,
          onRejected?: ((error: unknown) => unknown) | null,
        ) =>
          Promise.resolve(rowsFor(record.table)).then(
            onFulfilled,
            onRejected,
          ),
      };
      return link;
    },
    insert: (table: unknown) => {
      const record: { table: unknown; values: unknown } = {
        table,
        values: undefined,
      };
      inserts.push(record);
      return {
        values: (values: unknown) => {
          record.values = values;
          const write = () =>
            options.failInsertOn === table
              ? Promise.reject(new Error("insert_failed"))
              : Promise.resolve([]);
          const terminal = {
            then: (
              onFulfilled?: ((rows: Row[]) => unknown) | null,
              onRejected?: ((error: unknown) => unknown) | null,
            ) => write().then(onFulfilled, onRejected),
            returning: () => write().then(() => [{ id: "inserted-row" }]),
            onConflictDoNothing: () => ({
              then: (
                onFulfilled?: ((rows: Row[]) => unknown) | null,
                onRejected?: ((error: unknown) => unknown) | null,
              ) => write().then(onFulfilled, onRejected),
              returning: () =>
                write().then(() => [{ id: "activity-evt-1" }]),
            }),
            onConflictDoUpdate: () => ({
              then: (
                onFulfilled?: ((rows: Row[]) => unknown) | null,
                onRejected?: ((error: unknown) => unknown) | null,
              ) => write().then(onFulfilled, onRejected),
            }),
          };
          return terminal;
        },
      };
    },
    update: (table: unknown) => {
      const record: { table: unknown; set: unknown; where: unknown } = {
        table,
        set: undefined,
        where: undefined,
      };
      updates.push(record);
      return {
        set: (values: unknown) => {
          record.set = values;
          return {
            where: (cond: unknown) => {
              record.where = cond;
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    delete: (table: unknown) => {
      const record: { table: unknown; where: unknown } = {
        table,
        where: undefined,
      };
      deletes.push(record);
      return {
        where: (cond: unknown) => {
          record.where = cond;
          return {
            then: (
              onFulfilled?: ((rows: Row[]) => unknown) | null,
              onRejected?: ((error: unknown) => unknown) | null,
            ) =>
              Promise.resolve(rowsFor(table)).then(onFulfilled, onRejected),
            returning: () => Promise.resolve(rowsFor(table)),
          };
        },
      };
    },
  };
  return tx as unknown as ActivityTransaction;
}

const ALLIANCE_ID = "alliance-1";
const HQ_USER_ID = "hq-user-1";
const SESSION_ID = "sess-1";
const COMMANDER_ID = "cmd-1";
const MEMBER_ID = "member-1";
const DISCORD_ID = "discord-1";

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: HQ_USER_ID,
  sessionId: SESSION_ID,
  currentAllianceId: ALLIANCE_ID,
  permissions: new Set(["members:read"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function commanderRow(overrides: Row = {}): Row {
  return {
    currentKills: 100_000,
    killsUpdatedAt: new Date("2026-09-01T00:00:00Z"),
    primaryName: "Cmd",
    ...overrides,
  };
}

function webRows(overrides: Partial<Record<keyof typeof schema, Row[]>> = {}) {
  return new Map<unknown, Row[] | Row[][]>([
    [schema.alliances, [
      {
        id: ALLIANCE_ID,
        gameServerNumber: 1203,
        tag: "TST",
        name: "Test Alliance",
      },
    ]],
    [schema.sessions, [
      {
        hqUserId: HQ_USER_ID,
        currentAllianceId: ALLIANCE_ID,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]],
    [schema.hqUsers, [
      { id: HQ_USER_ID, displayName: "Web User", ashedUserId: null },
    ]],
    [schema.allianceMemberships, [{ name: "member", source: "manual" }]],
    [schema.hqUserCommanders, [
      {
        memberId: MEMBER_ID,
        commanderId: COMMANDER_ID,
        name: "Roster Name",
        primary: true,
      },
    ]],
    [schema.hqMemberLinks, []],
    [schema.allianceMembers, [
      {
        ashedMemberId: MEMBER_ID,
        currentName: "Roster Name",
        allianceRank: 4,
        status: "active",
      },
    ]],
    [schema.activityOwnershipAliases, []],
    [schema.commanders, [commanderRow()]],
    ...Object.entries(overrides).map(([key, rows]) => {
      const table = (schema as Record<string, unknown>)[key];
      return [table, rows] as [unknown, Row[]];
    }),
  ]);
}

function webActivity(method: "manual" | "screenshot" = "manual") {
  return {
    identity: { kind: "web" as const, principal: PRINCIPAL },
    method,
  };
}

describe("upsertCommanderKills activity wiring", () => {
  beforeEach(() => {
    selects.length = 0;
    inserts.length = 0;
    updates.length = 0;
    deletes.length = 0;
    executed.length = 0;
    alertMock.mockClear();
  });

  it("writes history, current, and activity in one transaction keyed by history id", async () => {
    currentTx = makeTx(webRows());
    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 125_000,
      allianceId: ALLIANCE_ID,
      ashedMemberId: MEMBER_ID,
      memberName: "Roster Name",
      source: "web",
      hqUserId: HQ_USER_ID,
      activity: webActivity(),
    });

    expect(changed).toBe(true);
    const commanderSelect = selects.find((s) => s.table === schema.commanders);
    expect(commanderSelect?.forMode).toBe("update");

    const history = inserts.find((i) => i.table === schema.commanderKillsEvents);
    const activityInsert = inserts.find((i) => i.table === schema.activityEvents);
    expect(history).toBeDefined();
    expect(activityInsert).toBeDefined();

    const historyValues = history!.values as Row;
    const activityValues = activityInsert!.values as Row;
    expect(historyValues.commanderId).toBe(COMMANDER_ID);
    expect(historyValues.total).toBe(125_000);
    expect(historyValues.previousTotal).toBe(100_000);
    expect(activityValues.sourceNamespace).toBe("commander-kills-events");
    expect(activityValues.sourceKey).toBe(historyValues.id);
    expect(activityValues.payload).toEqual({
      value: "125000",
      previousValue: "100000",
    });
    expect(activityValues.actorKind).toBe("hq");
    expect(activityValues.originalHqUserId).toBe(HQ_USER_ID);
    expect(activityValues.channel).toBe("web");
    expect(activityValues.method).toBe("manual");
    expect(activityValues.actorGameRank).toBe("R4");
    expect(
      (updates.find((u) => u.table === schema.commanders)!.set as Row)
        .currentKills,
    ).toBe(125_000);
  });

  it("returns false without history or activity when nothing changed", async () => {
    currentTx = makeTx(webRows());
    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 100_000,
      allianceId: ALLIANCE_ID,
      ashedMemberId: MEMBER_ID,
      source: "web",
      hqUserId: HQ_USER_ID,
      activity: webActivity(),
    });

    expect(changed).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("marks the latest video_parse event synced inside the same transaction on no-op", async () => {
    currentTx = makeTx(
      webRows({
        commanders: [commanderRow({ currentKills: 100_000 })],
        commanderKillsEvents: [
          { id: "evt-1", source: "video_parse", ashedSyncedAt: null },
        ],
      }),
    );
    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 100_000,
      allianceId: ALLIANCE_ID,
      ashedMemberId: MEMBER_ID,
      source: "ashed_sync",
      markAshedSynced: true,
    });

    expect(changed).toBe(false);
    const syncUpdate = updates.find(
      (u) => u.table === schema.commanderKillsEvents,
    );
    expect(syncUpdate).toBeDefined();
    expect((syncUpdate!.set as Row).ashedSyncedAt).toBeInstanceOf(Date);
    expect(
      inserts.some((i) => i.table === schema.commanderKillsEvents),
    ).toBe(false);
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(false);
  });

  it("never emits an activity event for background callers", async () => {
    currentTx = makeTx(
      new Map([[schema.commanders, [commanderRow()]]]),
    );
    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 125_000,
      source: "ashed_sync",
    });

    expect(changed).toBe(true);
    expect(
      inserts.some((i) => i.table === schema.commanderKillsEvents),
    ).toBe(true);
    expect(
      inserts.some((i) => i.table === schema.activityEvents),
    ).toBe(false);
  });

  it("propagates activity insert failure and schedules the post-rollback alert", async () => {
    currentTx = makeTx(webRows(), { failInsertOn: schema.activityEvents });

    await expect(
      upsertCommanderKills({
        commanderId: COMMANDER_ID,
        total: 125_000,
        allianceId: ALLIANCE_ID,
        ashedMemberId: MEMBER_ID,
        source: "web",
        hqUserId: HQ_USER_ID,
        activity: webActivity(),
      }),
    ).rejects.toBeInstanceOf(ActivityWriteError);
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the commander row is missing instead of fabricating an event", async () => {
    currentTx = makeTx(webRows({ commanders: [] }));

    await expect(
      upsertCommanderKills({
        commanderId: COMMANDER_ID,
        total: 125_000,
        allianceId: ALLIANCE_ID,
        ashedMemberId: MEMBER_ID,
        source: "web",
        hqUserId: HQ_USER_ID,
        activity: webActivity(),
      }),
    ).rejects.toThrow("commander_not_found");
    expect(
      inserts.some((i) => i.table === schema.activityEvents),
    ).toBe(false);
  });

  it("rejects mismatched actor context as a validation failure", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertCommanderKills({
        commanderId: "other-commander",
        total: 125_000,
        allianceId: ALLIANCE_ID,
        ashedMemberId: MEMBER_ID,
        source: "web",
        hqUserId: HQ_USER_ID,
        activity: webActivity(),
      }),
    ).rejects.toMatchObject({
      name: "ActivityWriteError",
      failureCategory: "validation",
    });
    expect(inserts).toHaveLength(0);
  });
});

describe("upsertCommanderKills pending consumption", () => {
  const expected = {
    kind: "anomaly_confirm" as const,
    proposedTotal: 125_000,
    commanderId: COMMANDER_ID,
  };

  beforeEach(() => {
    selects.length = 0;
    inserts.length = 0;
    updates.length = 0;
    deletes.length = 0;
    executed.length = 0;
    alertMock.mockClear();
  });

  it("deletes the exact pending row before locking the commander", async () => {
    currentTx = makeTx(
      webRows({ hqKillsPending: [{ allianceId: ALLIANCE_ID }] }),
    );

    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 125_000,
      allianceId: ALLIANCE_ID,
      ashedMemberId: MEMBER_ID,
      source: "web",
      hqUserId: HQ_USER_ID,
      activity: { ...webActivity(), pending: { expected, required: true } },
    });

    expect(changed).toBe(true);
    const pendingDelete = deletes.find((d) => d.table === schema.hqKillsPending);
    expect(pendingDelete).toBeDefined();
    const compiled = dialect.sqlToQuery(pendingDelete!.where as SQL);
    expect(compiled.sql).toContain("expires_at");
    expect(compiled.sql).toContain("::jsonb");
    expect(compiled.params).toContain(ALLIANCE_ID);
    expect(compiled.params).toContain(HQ_USER_ID);
    expect(compiled.params).toContain(JSON.stringify(expected));

    const commanderSelectIndex = selects.findIndex(
      (s) => s.table === schema.commanders && s.forMode === "update",
    );
    expect(commanderSelectIndex).toBeGreaterThanOrEqual(0);
  });

  it("throws KillsPendingChangedError when a required pending is gone", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertCommanderKills({
        commanderId: COMMANDER_ID,
        total: 125_000,
        allianceId: ALLIANCE_ID,
        ashedMemberId: MEMBER_ID,
        source: "web",
        hqUserId: HQ_USER_ID,
        activity: { ...webActivity(), pending: { expected, required: true } },
      }),
    ).rejects.toBeInstanceOf(KillsPendingChangedError);
    expect(alertMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("keeps writing when an optional pending no longer matches", async () => {
    currentTx = makeTx(webRows());

    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 125_000,
      allianceId: ALLIANCE_ID,
      ashedMemberId: MEMBER_ID,
      source: "web",
      hqUserId: HQ_USER_ID,
      activity: { ...webActivity(), pending: { expected, required: false } },
    });

    expect(changed).toBe(true);
    expect(
      inserts.some((i) => i.table === schema.commanderKillsEvents),
    ).toBe(true);
  });

  it("consumes discord pending rows for discord identity", async () => {
    const rows = new Map<unknown, Row[] | Row[][]>([
      [schema.alliances, [
        {
          id: ALLIANCE_ID,
          gameServerNumber: 1203,
          tag: "TST",
          name: "Test Alliance",
        },
      ]],
      [schema.discordHqLinks, []],
      [schema.discordMemberLinks, [
        { ashedMemberId: MEMBER_ID, memberDisplayName: "D User" },
      ]],
      [schema.commanderAllianceMemberships, [
        { memberId: MEMBER_ID, commanderId: COMMANDER_ID },
      ]],
      [schema.allianceMembers, [
        {
          ashedMemberId: MEMBER_ID,
          currentName: "D User",
          allianceRank: null,
          status: "active",
        },
      ]],
      [schema.activityOwnershipAliases, []],
      [schema.discordBotPending, [{ discordUserId: DISCORD_ID }]],
      [schema.commanders, [commanderRow()]],
    ]);
    currentTx = makeTx(rows);

    const changed = await upsertCommanderKills({
      commanderId: COMMANDER_ID,
      total: 125_000,
      allianceId: ALLIANCE_ID,
      ashedMemberId: MEMBER_ID,
      source: "screenshot_ocr",
      discordUserId: DISCORD_ID,
      activity: {
        identity: { kind: "discord", discordUserId: DISCORD_ID },
        method: "screenshot",
        pending: {
          expected: { ...expected, kind: "ocr_confirm" },
          required: true,
        },
      },
    });

    expect(changed).toBe(true);
    const pendingDelete = deletes.find(
      (d) => d.table === schema.discordBotPending,
    );
    expect(pendingDelete).toBeDefined();
    const compiled = dialect.sqlToQuery(pendingDelete!.where as SQL);
    expect(compiled.params).toContain(DISCORD_ID);
    const activityInsert = inserts.find((i) => i.table === schema.activityEvents);
    expect((activityInsert!.values as Row).actorKind).toBe("discord");
    expect((activityInsert!.values as Row).channel).toBe("discord");
    expect((activityInsert!.values as Row).method).toBe("screenshot");
  });
});
