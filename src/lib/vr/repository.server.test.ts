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
  upsertMemberSeasonVr,
  VrPendingChangedError,
  VrSubmissionChangedError,
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
  options: { failInsertOn?: unknown; conflictHighestBaseVr?: number } = {},
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
          const conflictRows = () => [
            {
              highestBaseVr:
                options.conflictHighestBaseVr ??
                (values as Row).highestBaseVr,
            },
          ];
          const terminal = {
            then: (
              onFulfilled?: ((rows: Row[]) => unknown) | null,
              onRejected?: ((error: unknown) => unknown) | null,
            ) => write().then(onFulfilled, onRejected),
            returning: () =>
              write().then(() => [{ id: "inserted-row" }]),
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
              returning: () => write().then(() => conflictRows()),
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
const SEASON_KEY = "1";

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: HQ_USER_ID,
  sessionId: SESSION_ID,
  currentAllianceId: ALLIANCE_ID,
  permissions: new Set(["members:read"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function webRows(overrides: Partial<Record<keyof typeof schema, Row[] | Row[][]>> = {}) {
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
    [schema.commanders, [{ id: COMMANDER_ID }]],
    [schema.commanderSeasonVr, []],
    ...Object.entries(overrides).map(([key, rows]) => {
      const table = (schema as Record<string, unknown>)[key];
      return [table, rows] as [unknown, Row[] | Row[][]];
    }),
  ]);
}

function webActivity(expectedPreviousBaseVr: number | null) {
  return {
    identity: { kind: "web" as const, principal: PRINCIPAL },
    expectedPreviousBaseVr,
  };
}

type UpsertInput = Parameters<typeof upsertMemberSeasonVr>[0];

function baseInput(overrides: Partial<UpsertInput> = {}): UpsertInput {
  return {
    commanderId: COMMANDER_ID,
    ashedMemberId: MEMBER_ID,
    allianceId: ALLIANCE_ID,
    seasonKey: SEASON_KEY,
    baseVr: 3400,
    eventSource: "web",
    hqUserId: HQ_USER_ID,
    ...overrides,
  };
}

describe("upsertMemberSeasonVr activity wiring", () => {
  beforeEach(() => {
    selects.length = 0;
    inserts.length = 0;
    updates.length = 0;
    deletes.length = 0;
    executed.length = 0;
    alertMock.mockClear();
  });

  it("writes summary, history, and activity keyed by history id", async () => {
    currentTx = makeTx(
      webRows({
        commanderSeasonVr: [
          [{ highestBaseVr: 3000 }],
          [
            {
              ashedMemberId: MEMBER_ID,
              highestBaseVr: 3000,
              source: "web",
              latest: {},
              memberName: "Roster Name",
              commanderName: "Cmd",
            },
          ],
        ],
      }),
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({ activity: webActivity(3000) }),
    );

    expect(changed).toBe(true);
    const commanderSelect = selects.find(
      (s) => s.table === schema.commanders && s.forMode === "update",
    );
    expect(commanderSelect).toBeDefined();
    const summarySelect = selects.find(
      (s) => s.table === schema.commanderSeasonVr && s.forMode === "update",
    );
    expect(summarySelect).toBeDefined();

    const summary = inserts.find((i) => i.table === schema.commanderSeasonVr);
    const history = inserts.find(
      (i) => i.table === schema.commanderSeasonVrEvents,
    );
    const activityInsert = inserts.find(
      (i) => i.table === schema.activityEvents,
    );
    expect(summary).toBeDefined();
    expect(history).toBeDefined();
    expect(activityInsert).toBeDefined();

    const historyValues = history!.values as Row;
    const activityValues = activityInsert!.values as Row;
    expect(historyValues.commanderId).toBe(COMMANDER_ID);
    expect(historyValues.baseVr).toBe(3400);
    expect(historyValues.previousBaseVr).toBe(3000);
    expect(historyValues.seasonKey).toBe(SEASON_KEY);
    expect(activityValues.eventKey).toBe("vr.submitted");
    expect(activityValues.sourceNamespace).toBe("commander-season-vr-events");
    expect(activityValues.sourceKey).toBe(historyValues.id);
    expect(activityValues.payload).toEqual({
      value: "3400",
      previousValue: "3000",
    });
    expect(activityValues.actorKind).toBe("hq");
    expect(activityValues.originalHqUserId).toBe(HQ_USER_ID);
    expect(activityValues.channel).toBe("web");
    expect(activityValues.method).toBe("manual");
    expect(activityValues.actorGameRank).toBe("R4");
  });

  it("records null previousValue for a first season submission", async () => {
    currentTx = makeTx(webRows());

    const changed = await upsertMemberSeasonVr(
      baseInput({ baseVr: 100, activity: webActivity(null) }),
    );

    expect(changed).toBe(true);
    const activityInsert = inserts.find(
      (i) => i.table === schema.activityEvents,
    );
    expect((activityInsert!.values as Row).payload).toEqual({
      value: "100",
      previousValue: null,
    });
  });

  it("returns false without history or activity on a no-op", async () => {
    currentTx = makeTx(
      webRows({
        commanderSeasonVr: [[{ highestBaseVr: 3400 }]],
      }),
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({ activity: webActivity(3400) }),
    );

    expect(changed).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("applies a one-level correction with matching expected value", async () => {
    currentTx = makeTx(
      webRows({
        commanderSeasonVr: [
          [{ highestBaseVr: 3400 }],
          [
            {
              ashedMemberId: MEMBER_ID,
              highestBaseVr: 3400,
              source: "web",
              latest: {},
              memberName: "Roster Name",
              commanderName: "Cmd",
            },
          ],
        ],
      }),
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({ baseVr: 3000, activity: webActivity(3400) }),
    );

    expect(changed).toBe(true);
    expect(
      inserts.some((i) => i.table === schema.commanderSeasonVrEvents),
    ).toBe(true);
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(true);
  });

  it("rejects a stale lower write racing a concurrent higher value", async () => {
    currentTx = makeTx(
      webRows({
        commanderSeasonVr: [[{ highestBaseVr: 3400 }]],
        hqVrPending: [{ allianceId: ALLIANCE_ID }],
      }),
    );

    await expect(
      upsertMemberSeasonVr(
        baseInput({ baseVr: 3000, activity: webActivity(2750) }),
      ),
    ).rejects.toBeInstanceOf(VrSubmissionChangedError);
    expect(inserts).toHaveLength(0);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("rejects a correction larger than one ladder level", async () => {
    currentTx = makeTx(
      webRows({
        commanderSeasonVr: [[{ highestBaseVr: 3400 }]],
      }),
    );

    await expect(
      upsertMemberSeasonVr(
        baseInput({ baseVr: 2750, activity: webActivity(3400) }),
      ),
    ).rejects.toBeInstanceOf(VrSubmissionChangedError);
    expect(inserts).toHaveLength(0);
  });

  it("throws when the conflict resolution unexpectedly keeps a higher value", async () => {
    currentTx = makeTx(
      webRows({
        commanderSeasonVr: [
          [{ highestBaseVr: 3000 }],
          [
            {
              ashedMemberId: MEMBER_ID,
              highestBaseVr: 3000,
              source: "web",
              latest: {},
              memberName: "Roster Name",
              commanderName: "Cmd",
            },
          ],
        ],
      }),
      { conflictHighestBaseVr: 3800 },
    );

    await expect(
      upsertMemberSeasonVr(
        baseInput({ activity: webActivity(3000) }),
      ),
    ).rejects.toBeInstanceOf(VrSubmissionChangedError);
    expect(
      inserts.some((i) => i.table === schema.commanderSeasonVrEvents),
    ).toBe(false);
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(false);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("rejects a base VR that is not a season ladder value", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertMemberSeasonVr(
        baseInput({ baseVr: 3_333, activity: webActivity(null) }),
      ),
    ).rejects.toBeInstanceOf(VrSubmissionChangedError);
    expect(inserts).toHaveLength(0);
  });

  it("drops a stale backfill write when the season row moved under the lock", async () => {
    currentTx = makeTx(
      new Map<unknown, Row[] | Row[][]>([
        [schema.commanders, [{ id: COMMANDER_ID }]],
        [schema.commanderSeasonVr, [
          [{ highestBaseVr: 3000 }],
          [{ highestBaseVr: 3400 }],
          [
            {
              ashedMemberId: MEMBER_ID,
              highestBaseVr: 3400,
              source: "web",
              latest: {},
              memberName: "Roster Name",
              commanderName: "Cmd",
            },
          ],
        ]],
      ]),
      { conflictHighestBaseVr: 3400 },
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({ baseVr: 3000, eventSource: "backfill", hqUserId: undefined }),
    );

    expect(changed).toBe(false);
    expect(
      inserts.some((i) => i.table === schema.commanderSeasonVrEvents),
    ).toBe(false);
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(false);
  });

  it("never emits an activity event for unattributed backfill callers", async () => {
    currentTx = makeTx(
      new Map<unknown, Row[] | Row[][]>([
        [schema.commanders, [{ id: COMMANDER_ID }]],
        [schema.commanderSeasonVr, [[{ highestBaseVr: 3000 }], []]],
      ]),
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({ eventSource: "backfill", hqUserId: undefined }),
    );

    expect(changed).toBe(true);
    expect(
      inserts.some((i) => i.table === schema.commanderSeasonVrEvents),
    ).toBe(true);
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(false);
  });

  it("propagates activity insert failure and schedules the post-rollback alert", async () => {
    currentTx = makeTx(webRows(), { failInsertOn: schema.activityEvents });

    await expect(
      upsertMemberSeasonVr(
        baseInput({ baseVr: 100, activity: webActivity(null) }),
      ),
    ).rejects.toBeInstanceOf(ActivityWriteError);
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the commander row is missing instead of fabricating an event", async () => {
    currentTx = makeTx(webRows({ commanders: [] }));

    await expect(
      upsertMemberSeasonVr(
        baseInput({ baseVr: 100, activity: webActivity(null) }),
      ),
    ).rejects.toThrow("commander_required_for_vr");
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(false);
  });

  it("rejects mismatched actor context as a validation failure", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertMemberSeasonVr(
        baseInput({
          commanderId: "other-commander",
          baseVr: 100,
          activity: webActivity(null),
        }),
      ),
    ).rejects.toMatchObject({
      name: "ActivityWriteError",
      failureCategory: "validation",
    });
    expect(inserts).toHaveLength(0);
  });

  it("rejects a mismatched eventSource as a validation failure", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertMemberSeasonVr(
        baseInput({
          eventSource: "backfill",
          baseVr: 3400,
          activity: webActivity(3000),
        }),
      ),
    ).rejects.toMatchObject({
      name: "ActivityWriteError",
      failureCategory: "validation",
    });
    expect(inserts).toHaveLength(0);
  });

  it("rejects an invalid expectedPreviousBaseVr as a validation failure", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertMemberSeasonVr(
        baseInput({
          baseVr: 3400,
          activity: webActivity(-1),
        }),
      ),
    ).rejects.toMatchObject({
      name: "ActivityWriteError",
      failureCategory: "validation",
    });
    expect(inserts).toHaveLength(0);
  });
});

describe("upsertMemberSeasonVr pending consumption", () => {
  const expected = {
    kind: "anomaly_confirm" as const,
    proposedVr: 8000,
    ashedMemberId: MEMBER_ID,
    commanderId: COMMANDER_ID,
    seasonKey: SEASON_KEY,
  };

  beforeEach(() => {
    selects.length = 0;
    inserts.length = 0;
    updates.length = 0;
    deletes.length = 0;
    executed.length = 0;
    alertMock.mockClear();
  });

  it("deletes the exact pending row inside the transaction", async () => {
    currentTx = makeTx(
      webRows({
        hqVrPending: [{ allianceId: ALLIANCE_ID }],
        commanderSeasonVr: [
          [{ highestBaseVr: 3000 }],
          [
            {
              ashedMemberId: MEMBER_ID,
              highestBaseVr: 3000,
              source: "web",
              latest: {},
              memberName: "Roster Name",
              commanderName: "Cmd",
            },
          ],
        ],
      }),
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({
        baseVr: 8000,
        activity: {
          ...webActivity(3000),
          pending: { expected, required: true },
        },
      }),
    );

    expect(changed).toBe(true);
    const pendingDelete = deletes.find((d) => d.table === schema.hqVrPending);
    expect(pendingDelete).toBeDefined();
    const compiled = dialect.sqlToQuery(pendingDelete!.where as SQL);
    expect(compiled.sql).toContain("expires_at");
    expect(compiled.sql).toContain("::jsonb");
    expect(compiled.params).toContain(ALLIANCE_ID);
    expect(compiled.params).toContain(HQ_USER_ID);
    expect(compiled.params).toContain(JSON.stringify(expected));
  });

  it("throws VrPendingChangedError when a required pending is gone", async () => {
    currentTx = makeTx(webRows());

    await expect(
      upsertMemberSeasonVr(
        baseInput({
          baseVr: 8000,
          activity: {
            ...webActivity(null),
            pending: { expected, required: true },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(VrPendingChangedError);
    expect(alertMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("throws VrPendingChangedError for a different-season prompt before deleting", async () => {
    currentTx = makeTx(webRows({ hqVrPending: [{ allianceId: ALLIANCE_ID }] }));

    await expect(
      upsertMemberSeasonVr(
        baseInput({
          baseVr: 8000,
          activity: {
            ...webActivity(null),
            pending: {
              expected: { ...expected, seasonKey: "2" },
              required: true,
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(VrPendingChangedError);
    expect(deletes).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("consumes a matching obsolete-season prompt and still writes on optional pending", async () => {
    currentTx = makeTx(
      webRows({
        hqVrPending: [{ allianceId: ALLIANCE_ID }],
        commanderSeasonVr: [
          [{ highestBaseVr: 3000 }],
          [
            {
              ashedMemberId: MEMBER_ID,
              highestBaseVr: 3000,
              source: "web",
              latest: {},
              memberName: "Roster Name",
              commanderName: "Cmd",
            },
          ],
        ],
      }),
    );

    const changed = await upsertMemberSeasonVr(
      baseInput({
        activity: {
          ...webActivity(3000),
          pending: {
            expected: { ...expected, seasonKey: "2" },
            required: false,
          },
        },
      }),
    );

    expect(changed).toBe(true);
    const pendingDelete = deletes.find((d) => d.table === schema.hqVrPending);
    expect(pendingDelete).toBeDefined();
    const history = inserts.find(
      (i) => i.table === schema.commanderSeasonVrEvents,
    );
    expect((history!.values as Row).seasonKey).toBe(SEASON_KEY);
    expect(inserts.some((i) => i.table === schema.activityEvents)).toBe(true);
  });

  it("writes a fresh submission when an optional pending no longer matches", async () => {
    currentTx = makeTx(webRows());

    const changed = await upsertMemberSeasonVr(
      baseInput({
        baseVr: 3400,
        activity: {
          ...webActivity(null),
          pending: { expected, required: false },
        },
      }),
    );

    expect(changed).toBe(true);
    expect(
      inserts.some((i) => i.table === schema.commanderSeasonVrEvents),
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
      [schema.commanders, [{ id: COMMANDER_ID }]],
      [schema.commanderSeasonVr, [
        [{ highestBaseVr: 3000 }],
        [
          {
            ashedMemberId: MEMBER_ID,
            highestBaseVr: 3000,
            source: "discord",
            latest: {},
            memberName: "D User",
            commanderName: "Cmd",
          },
        ],
      ]],
    ]);
    currentTx = makeTx(rows);

    const changed = await upsertMemberSeasonVr(
      baseInput({
        baseVr: 8000,
        eventSource: "discord",
        hqUserId: undefined,
        discordUserId: DISCORD_ID,
        activity: {
          identity: { kind: "discord", discordUserId: DISCORD_ID },
          expectedPreviousBaseVr: 3000,
          pending: { expected, required: true },
        },
      }),
    );

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
    expect((activityInsert!.values as Row).method).toBe("manual");
  });
});
