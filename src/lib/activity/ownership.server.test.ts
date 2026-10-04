import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import {
  ActivityIdentityChangedError,
  claimDiscordActivityOwnership,
  lockActivityIdentity,
  lockActivityMergeOwners,
  remapActivityOwnership,
  resolveActivityPersonalOwner,
} from "./ownership.server";
import type { ActivityTransaction } from "./writer.server";

const dialect = new PgDialect();

type RecordedSelect = {
  table: unknown;
  joins: { table: unknown; on: unknown }[];
  where: unknown;
  limit: number | null;
  forMode: string | null;
};

type RecordedUpdate = { table: unknown; set: unknown; where: unknown };

type RecordedInsert = {
  table: unknown;
  values: unknown;
  onConflict: unknown;
};

type Row = Record<string, unknown>;

function makeTx(rowsByTable: Map<unknown, Row[] | Row[][]> = new Map()) {
  const selects: RecordedSelect[] = [];
  const executed: unknown[] = [];
  const updates: RecordedUpdate[] = [];
  const inserts: RecordedInsert[] = [];
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
        joins: [],
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
        innerJoin: (table: unknown, on: unknown) => {
          record.joins.push({ table, on });
          return link;
        },
        where: (cond: unknown) => {
          record.where = cond;
          return link;
        },
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
      const record: RecordedInsert = {
        table,
        values: undefined,
        onConflict: undefined,
      };
      inserts.push(record);
      return {
        values: (values: unknown) => {
          record.values = values;
          return {
            onConflictDoUpdate: (config: unknown) => {
              record.onConflict = config;
              return Promise.resolve([]);
            },
            onConflictDoNothing: (config: unknown) => {
              record.onConflict = config;
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    update: (table: unknown) => {
      const record: RecordedUpdate = {
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
  };
  return {
    tx: tx as unknown as ActivityTransaction,
    selects,
    executed,
    updates,
    inserts,
  };
}

function lockKeys(executed: unknown[]): string[] {
  return executed.map((arg) => {
    const { sql, params } = dialect.sqlToQuery(arg as SQL);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("hashtextextended");
    return String(params[0]);
  });
}

describe("lockActivityIdentity", () => {
  it("takes sorted, deduped advisory locks discord before hq", async () => {
    const { tx, executed } = makeTx();
    await lockActivityIdentity(tx, {
      discordUserId: "d-1",
      hqUserIds: ["hq-2", "hq-1", "hq-1"],
    });
    expect(lockKeys(executed)).toEqual([
      "activity:discord:d-1",
      "activity:hq:hq-1",
      "activity:hq:hq-2",
    ]);
  });

  it("rejects invalid ids before any sql", async () => {
    const { tx, executed, selects } = makeTx();
    await expect(
      lockActivityIdentity(tx, { discordUserId: "has space" }),
    ).rejects.toThrow();
    await expect(
      lockActivityIdentity(tx, { discordUserId: "" }),
    ).rejects.toThrow();
    await expect(
      lockActivityIdentity(tx, { hqUserIds: [""] }),
    ).rejects.toThrow();
    await expect(
      lockActivityIdentity(tx, { hqUserIds: ["bad@id"] }),
    ).rejects.toThrow();
    expect(executed).toHaveLength(0);
    expect(selects).toHaveLength(0);
  });
});

describe("resolveActivityPersonalOwner", () => {
  it("resolves a known hq owner through a one-hop alias without reading discord", async () => {
    const { tx, selects, executed } = makeTx(
      new Map([[schema.activityOwnershipAliases, [{ owner: "hq-b" }]]]),
    );
    const owner = await resolveActivityPersonalOwner(tx, {
      hqUserId: "hq-a",
      discordUserId: "d-ignored",
    });
    expect(owner).toBe("hq-b");
    expect(lockKeys(executed)).toEqual(["activity:hq:hq-a"]);
    expect(selectForTable(selects, schema.discordHqLinks)).toBeUndefined();
    const aliasSelect = selectForTable(
      selects,
      schema.activityOwnershipAliases,
    );
    const { sql, params } = dialect.sqlToQuery(aliasSelect?.where as SQL);
    expect(sql).toContain("original_hq_user_id");
    expect(params).toEqual(["hq-a"]);
  });

  it("returns the original hq owner when no alias exists", async () => {
    const { tx } = makeTx();
    const owner = await resolveActivityPersonalOwner(tx, {
      hqUserId: "hq-a",
      discordUserId: null,
    });
    expect(owner).toBe("hq-a");
  });

  it("resolves an unowned discord actor through the verified link then the alias", async () => {
    const { tx, selects, executed } = makeTx(
      new Map<unknown, Row[]>([
        [schema.discordHqLinks, [{ hqUserId: "hq-a" }]],
        [schema.activityOwnershipAliases, [{ owner: "hq-b" }]],
      ]),
    );
    const owner = await resolveActivityPersonalOwner(tx, {
      hqUserId: null,
      discordUserId: "d-1",
    });
    expect(owner).toBe("hq-b");
    expect(lockKeys(executed)).toEqual([
      "activity:discord:d-1",
      "activity:hq:hq-a",
    ]);
    const linkSelect = selectForTable(selects, schema.discordHqLinks);
    expect(linkSelect?.forMode).toBe("share");
  });

  it("returns null for an unlinked discord actor", async () => {
    const { tx, executed } = makeTx();
    const owner = await resolveActivityPersonalOwner(tx, {
      hqUserId: null,
      discordUserId: "d-1",
    });
    expect(owner).toBeNull();
    expect(lockKeys(executed)).toEqual(["activity:discord:d-1"]);
  });

  it("runs no sql for an anonymous actor", async () => {
    const { tx, executed, selects } = makeTx();
    const owner = await resolveActivityPersonalOwner(tx, {
      hqUserId: null,
      discordUserId: null,
    });
    expect(owner).toBeNull();
    expect(executed).toHaveLength(0);
    expect(selects).toHaveLength(0);
  });

  it("rejects invalid ids before any sql", async () => {
    const { tx, executed, selects } = makeTx();
    await expect(
      resolveActivityPersonalOwner(tx, {
        hqUserId: "bad id",
        discordUserId: null,
      }),
    ).rejects.toThrow();
    await expect(
      resolveActivityPersonalOwner(tx, {
        hqUserId: null,
        discordUserId: "",
      }),
    ).rejects.toThrow();
    expect(executed).toHaveLength(0);
    expect(selects).toHaveLength(0);
  });
});

describe("lockActivityMergeOwners", () => {
  it("locks source, canonical and every alias owner in sorted order", async () => {
    const { tx, executed } = makeTx(
      new Map([
        [
          schema.activityOwnershipAliases,
          [
            { originalHqUserId: "hq-z1" },
            { originalHqUserId: "hq-a1" },
            { originalHqUserId: "hq-a1" },
          ],
        ],
      ]),
    );
    await lockActivityMergeOwners(tx, "hq-source", "hq-canonical");
    expect(lockKeys(executed)).toEqual([
      "activity:hq:hq-a1",
      "activity:hq:hq-canonical",
      "activity:hq:hq-source",
      "activity:hq:hq-z1",
    ]);
  });

  it("throws identity changed when the alias set shifts under the locks", async () => {
    const { tx, updates, inserts } = makeTx(
      new Map([
        [
          schema.activityOwnershipAliases,
          [
            [{ originalHqUserId: "hq-a1" }],
            [
              { originalHqUserId: "hq-a1" },
              { originalHqUserId: "hq-a2" },
            ],
          ],
        ],
      ]),
    );
    await expect(
      lockActivityMergeOwners(tx, "hq-source", "hq-canonical"),
    ).rejects.toBeInstanceOf(ActivityIdentityChangedError);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe("remapActivityOwnership — alias ledger", () => {
  it("flattens source aliases and records the remap idempotently", async () => {
    const { tx, executed, updates, inserts } = makeTx(
      new Map([[schema.activityOwnershipAliases, [[], [], []]]]),
    );
    await remapActivityOwnership(tx, "hq-source", "hq-canonical");
    expect(lockKeys(executed)).toEqual([
      "activity:hq:hq-canonical",
      "activity:hq:hq-source",
    ]);
    expect(updates).toHaveLength(2);
    expect(updates[0].table).toBe(schema.activityEvents);
    expect(updates[0].set).toEqual({
      personalOwnerHqUserId: "hq-canonical",
    });
    const eventWhere = dialect.sqlToQuery(updates[0].where as SQL);
    expect(eventWhere.sql).toContain("personal_owner_hq_user_id");
    expect(eventWhere.params).toEqual(["hq-source"]);
    expect(updates[1].table).toBe(schema.activityOwnershipAliases);
    expect(updates[1].set).toEqual({
      personalOwnerHqUserId: "hq-canonical",
    });
    const aliasWhere = dialect.sqlToQuery(updates[1].where as SQL);
    expect(aliasWhere.params).toEqual(["hq-source"]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(schema.activityOwnershipAliases);
    expect(inserts[0].values).toEqual({
      originalHqUserId: "hq-source",
      personalOwnerHqUserId: "hq-canonical",
    });
  });

  it("rejects when the canonical account is already a merged alias", async () => {
    const { tx, updates, inserts } = makeTx(
      new Map([
        [
          schema.activityOwnershipAliases,
          [[], [], [{ owner: "hq-ultimate" }]],
        ],
      ]),
    );
    await expect(
      remapActivityOwnership(tx, "hq-source", "hq-canonical"),
    ).rejects.toBeInstanceOf(ActivityIdentityChangedError);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("rejects redirecting a source alias already owned elsewhere", async () => {
    const { tx, updates, inserts } = makeTx(
      new Map([
        [
          schema.activityOwnershipAliases,
          [[], [], [], [{ owner: "hq-other" }]],
        ],
      ]),
    );
    await expect(
      remapActivityOwnership(tx, "hq-source", "hq-canonical"),
    ).rejects.toBeInstanceOf(ActivityIdentityChangedError);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("is an idempotent no-op when the source alias already points at canonical", async () => {
    const { tx, updates, inserts } = makeTx(
      new Map([
        [
          schema.activityOwnershipAliases,
          [[], [], [], [{ owner: "hq-canonical" }]],
        ],
      ]),
    );
    await remapActivityOwnership(tx, "hq-source", "hq-canonical");
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("validates both ids before the same-account no-op", async () => {
    const { tx, executed } = makeTx();
    await expect(remapActivityOwnership(tx, "", "")).rejects.toThrow();
    expect(executed).toHaveLength(0);
  });
});

describe("claimDiscordActivityOwnership", () => {
  it("verifies the link under share lock then claims only unowned discord rows", async () => {
    const { tx, selects, executed, updates } = makeTx(
      new Map([[schema.discordHqLinks, [{ hqUserId: "hq-1" }]]]),
    );
    await claimDiscordActivityOwnership(tx, {
      discordUserId: "d-1",
      hqUserId: "hq-1",
    });
    expect(lockKeys(executed)).toEqual([
      "activity:discord:d-1",
      "activity:hq:hq-1",
    ]);
    expect(selects).toHaveLength(1);
    const linkSelect = selects[0];
    expect(linkSelect.table).toBe(schema.discordHqLinks);
    expect(linkSelect.forMode).toBe("share");
    const linkWhere = dialect.sqlToQuery(linkSelect.where as SQL);
    expect(linkWhere.sql).toContain("discord_user_id");
    expect(linkWhere.params).toContain("d-1");
    expect(updates).toHaveLength(1);
    const update = updates[0];
    expect(update.table).toBe(schema.activityEvents);
    expect(update.set).toEqual({ personalOwnerHqUserId: "hq-1" });
    const { sql, params } = dialect.sqlToQuery(update.where as SQL);
    expect(sql).toContain("actor_kind");
    expect(sql).toContain("original_discord_user_id");
    expect(sql).toContain("personal_owner_hq_user_id");
    expect(sql).toContain("is null");
    expect(params).toContain("discord");
    expect(params).toContain("d-1");
  });

  it("throws activity_identity_changed when the link is missing or mismatched", async () => {
    for (const rows of [
      new Map(),
      new Map([[schema.discordHqLinks, [{ hqUserId: "hq-other" }]]]),
    ]) {
      const { tx, updates } = makeTx(rows);
      await expect(
        claimDiscordActivityOwnership(tx, {
          discordUserId: "d-1",
          hqUserId: "hq-1",
        }),
      ).rejects.toThrow("activity_identity_changed");
      expect(updates).toHaveLength(0);
    }
  });

  it("rejects invalid ids before any sql", async () => {
    const { tx, executed, selects, updates } = makeTx();
    await expect(
      claimDiscordActivityOwnership(tx, {
        discordUserId: "",
        hqUserId: "hq-1",
      }),
    ).rejects.toThrow();
    await expect(
      claimDiscordActivityOwnership(tx, {
        discordUserId: "d-1",
        hqUserId: "has space",
      }),
    ).rejects.toThrow();
    expect(executed).toHaveLength(0);
    expect(selects).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("remapActivityOwnership", () => {
  it("moves ownership from source to canonical under both locks", async () => {
    const { tx, executed, updates } = makeTx();
    await remapActivityOwnership(tx, "hq-source", "hq-canonical");
    expect(lockKeys(executed)).toEqual([
      "activity:hq:hq-canonical",
      "activity:hq:hq-source",
    ]);
    expect(updates).toHaveLength(2);
    const update = updates[0];
    expect(update.table).toBe(schema.activityEvents);
    expect(update.set).toEqual({ personalOwnerHqUserId: "hq-canonical" });
    const { sql, params } = dialect.sqlToQuery(update.where as SQL);
    expect(sql).toContain("personal_owner_hq_user_id");
    expect(params).toEqual(["hq-source"]);
  });

  it("is a no-op when source and canonical are the same account", async () => {
    const { tx, executed, selects, updates } = makeTx();
    await remapActivityOwnership(tx, "hq-1", "hq-1");
    expect(executed).toHaveLength(0);
    expect(selects).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("rejects invalid ids before any sql", async () => {
    const { tx, executed, updates } = makeTx();
    await expect(remapActivityOwnership(tx, "", "hq-1")).rejects.toThrow();
    await expect(
      remapActivityOwnership(tx, "hq-1", "bad@id"),
    ).rejects.toThrow();
    expect(executed).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

function selectForTable(
  selects: RecordedSelect[],
  table: unknown,
): RecordedSelect | undefined {
  return selects.find((select) => select.table === table);
}
