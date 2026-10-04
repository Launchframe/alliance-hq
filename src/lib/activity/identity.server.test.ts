import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

import type { ActivityPrincipal } from "./access.server";
import { ActivityWriteError } from "./errors.server";
import {
  captureActivityContext,
  type ActivityAllianceReference,
  type ActivityIdentity,
} from "./identity.server";
import type { ActivityMethod } from "./types.shared";
import type { ActivityTransaction } from "./writer.server";

vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("captureActivityContext must not use global getDb");
  },
}));

const dialect = new PgDialect();

const PRINCIPAL: ActivityPrincipal = {
  hqUserId: "hq-1",
  sessionId: "sess-1",
  currentAllianceId: "alliance-1",
  permissions: new Set<string>(),
  isPlatformMaintainer: false,
  scopeFence: "fence",
};

const ALLIANCE = {
  id: "alliance-1",
  server: 1203,
  tag: "LFgo",
  name: "Launchframe",
};

const SESSION = {
  hqUserId: "hq-1",
  currentAllianceId: "alliance-1",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

const HQ_USER = {
  id: "hq-1",
  displayName: "Cmdr One",
  ashedUserId: "ashed-u-1",
};

type Row = Record<string, unknown>;
type RowMap = Map<unknown, Row[]>;

type RecordedSelect = {
  table: unknown;
  joins: { table: unknown; on: unknown }[];
  where: unknown;
  limit: number | null;
  forMode: string | null;
};

function makeTx(rowsByTable: RowMap) {
  const selects: RecordedSelect[] = [];
  const executed: unknown[] = [];
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
          Promise.resolve(rowsByTable.get(record.table) ?? []).then(
            onFulfilled,
            onRejected,
          ),
      };
      return link;
    },
    update: () => {
      throw new Error("captureActivityContext must not update rows");
    },
  };
  return {
    tx: tx as unknown as ActivityTransaction,
    selects,
    executed,
  };
}

function baseRows(): RowMap {
  return new Map<unknown, Row[]>([
    [schema.alliances, [ALLIANCE]],
    [schema.sessions, [SESSION]],
    [schema.hqUsers, [HQ_USER]],
    [schema.allianceMemberships, [{ name: "owner", source: "manual" }]],
    [
      schema.hqUserCommanders,
      [
        {
          memberId: "m-1",
          commanderId: "cmdr-1",
          name: "Cmdr One",
          primary: true,
        },
      ],
    ],
    [
      schema.allianceMembers,
      [
        {
          ashedMemberId: "m-1",
          currentName: "Cmdr One",
          allianceRank: 4,
          status: "active",
        },
      ],
    ],
  ]);
}

function capture(
  tx: ActivityTransaction,
  overrides: {
    identity?: ActivityIdentity;
    alliance?: ActivityAllianceReference | null;
    actingMemberId?: string | null;
    method?: ActivityMethod | null;
  } = {},
) {
  return captureActivityContext(tx, {
    eventKey: "thp.submitted",
    identity: overrides.identity ?? { kind: "web", principal: PRINCIPAL },
    alliance:
      overrides.alliance === undefined
        ? { kind: "hq", id: "alliance-1" }
        : overrides.alliance,
    actingMemberId: overrides.actingMemberId,
    method: overrides.method === undefined ? "manual" : overrides.method,
  });
}

function selectFor(
  selects: RecordedSelect[],
  table: unknown,
): RecordedSelect | undefined {
  return selects.find((select) => select.table === table);
}

async function expectValidation(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ActivityWriteError);
    expect((error as ActivityWriteError).failureCategory).toBe("validation");
    return;
  }
  throw new Error("expected ActivityWriteError validation failure");
}

function lockKeys(executed: unknown[]): string[] {
  return executed.map((arg) => {
    const { sql, params } = dialect.sqlToQuery(arg as SQL);
    expect(sql).toContain("pg_advisory_xact_lock");
    return String(params[0]);
  });
}

describe("captureActivityContext — web identity", () => {
  it("snapshots hq owner role, display name and R4 primary commander", async () => {
    const { tx, selects, executed } = makeTx(baseRows());
    const ctx = await capture(tx);
    expect(ctx.channel).toBe("web");
    expect(ctx.method).toBe("manual");
    expect(ctx.scope).toEqual({
      allianceId: "alliance-1",
      serverNumber: "1203",
      allianceTag: "LFgo",
      allianceName: "Launchframe",
    });
    expect(ctx.actor).toEqual({
      kind: "hq",
      hqUserId: "hq-1",
      discordUserId: null,
      personalOwnerHqUserId: "hq-1",
      commanderId: "cmdr-1",
      displayName: "Cmdr One",
      hqRole: "owner",
      gameRank: "R4",
    });
    expect(lockKeys(executed)).toEqual(["activity:hq:hq-1"]);
    const sessionSelect = selectFor(selects, schema.sessions);
    expect(sessionSelect?.forMode).toBe("share");
    const sessionWhere = dialect.sqlToQuery(sessionSelect?.where as SQL);
    expect(sessionWhere.params).toEqual(["sess-1"]);
    const hqSelect = selectFor(selects, schema.hqUsers);
    expect(hqSelect?.forMode).toBe("share");
    const membership = selectFor(selects, schema.allianceMemberships);
    expect(membership?.joins[0]?.table).toBe(schema.roles);
    const membershipWhere = dialect.sqlToQuery(membership?.where as SQL);
    expect(membershipWhere.params).toEqual(["hq-1", "alliance-1", "active"]);
  });

  it("keeps channel independent from a non-manual method", async () => {
    const { tx } = makeTx(baseRows());
    const ctx = await capture(tx, { method: "screenshot" });
    expect(ctx.channel).toBe("web");
    expect(ctx.method).toBe("screenshot");
  });

  it("falls back to a legacy member link when no canonical commander exists", async () => {
    const rows = baseRows();
    rows.set(schema.hqUserCommanders, []);
    rows.set(schema.hqMemberLinks, [
      { ashedMemberId: "m-9", memberDisplayName: "Legacy Nine" },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-9",
        currentName: "Legacy Nine",
        allianceRank: 2,
        status: "active",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBe("R2");
    expect(ctx.actor.displayName).toBe("Cmdr One");
  });

  it("selects an explicit own non-primary commander", async () => {
    const rows = baseRows();
    rows.set(schema.hqUserCommanders, [
      {
        memberId: "m-1",
        commanderId: "cmdr-1",
        name: "Cmdr One",
        primary: true,
      },
      {
        memberId: "m-2",
        commanderId: "cmdr-2",
        name: "Cmdr Two",
        primary: false,
      },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: 4,
        status: "active",
      },
      {
        ashedMemberId: "m-2",
        currentName: "Cmdr Two",
        allianceRank: 2,
        status: "active",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx, { actingMemberId: "m-2" });
    expect(ctx.actor.commanderId).toBe("cmdr-2");
    expect(ctx.actor.gameRank).toBe("R2");
  });

  it("rejects an explicit member that is another user's, another tenant's or former", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: 4,
        status: "active",
      },
      {
        ashedMemberId: "m-other",
        currentName: "Other Member",
        allianceRank: 5,
        status: "active",
      },
      {
        ashedMemberId: "m-former",
        currentName: "Former Member",
        allianceRank: 3,
        status: "former",
      },
    ]);
    for (const actingMemberId of ["m-other", "m-former", "m-stranger"]) {
      const { tx } = makeTx(rows);
      await expectValidation(capture(tx, { actingMemberId }));
    }
  });

  it("omits commander and rank when multiple candidates have no primary", async () => {
    const rows = baseRows();
    rows.set(schema.hqUserCommanders, [
      {
        memberId: "m-1",
        commanderId: "cmdr-1",
        name: "Cmdr One",
        primary: false,
      },
      {
        memberId: "m-2",
        commanderId: "cmdr-2",
        name: "Cmdr Two",
        primary: false,
      },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: 5,
        status: "active",
      },
      {
        ashedMemberId: "m-2",
        currentName: "Cmdr Two",
        allianceRank: 2,
        status: "active",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBeNull();
  });

  it("omits commander and rank when multiple primaries are recorded", async () => {
    const rows = baseRows();
    rows.set(schema.hqUserCommanders, [
      {
        memberId: "m-1",
        commanderId: "cmdr-1",
        name: "Cmdr One",
        primary: true,
      },
      {
        memberId: "m-2",
        commanderId: "cmdr-2",
        name: "Cmdr Two",
        primary: true,
      },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: 3,
        status: "active",
      },
      {
        ashedMemberId: "m-2",
        currentName: "Cmdr Two",
        allianceRank: 3,
        status: "active",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBeNull();
  });

  it("lets the canonical commander win over a duplicate legacy link", async () => {
    const rows = baseRows();
    rows.set(schema.hqMemberLinks, [
      { ashedMemberId: "m-1", memberDisplayName: "Legacy Duplicate" },
      { ashedMemberId: "m-7", memberDisplayName: "Legacy Seven" },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: 4,
        status: "active",
      },
      {
        ashedMemberId: "m-7",
        currentName: "Legacy Seven",
        allianceRank: 2,
        status: "active",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.commanderId).toBe("cmdr-1");
    expect(ctx.actor.gameRank).toBe("R4");
  });

  it("omits rank for out-of-range roster values without fallback", async () => {
    for (const allianceRank of [0, 6]) {
      const rows = baseRows();
      rows.set(schema.allianceMembers, [
        {
          ashedMemberId: "m-1",
          currentName: "Cmdr One",
          allianceRank,
          status: "active",
        },
      ]);
      const { tx } = makeTx(rows);
      const ctx = await capture(tx);
      expect(ctx.actor.commanderId).toBe("cmdr-1");
      expect(ctx.actor.gameRank).toBeNull();
    }
  });

  it("compiles canonical commander and roster queries against the alliance", async () => {
    const { tx, selects } = makeTx(baseRows());
    await capture(tx);
    const canonical = selectFor(selects, schema.hqUserCommanders);
    expect(canonical?.joins[0]?.table).toBe(
      schema.commanderAllianceMemberships,
    );
    const canonicalWhere = dialect.sqlToQuery(canonical?.where as SQL);
    expect(canonicalWhere.sql).toContain("hq_user_id");
    expect(canonicalWhere.sql).toContain("alliance_id");
    expect(canonicalWhere.sql).toContain("status");
    expect(canonicalWhere.sql).toContain("left_at");
    expect(canonicalWhere.sql).toContain("is null");
    expect(canonicalWhere.params).toEqual([
      "hq-1",
      "alliance-1",
      "active",
    ]);
    const legacy = selectFor(selects, schema.hqMemberLinks);
    const legacyWhere = dialect.sqlToQuery(legacy?.where as SQL);
    expect(legacyWhere.params).toEqual(["hq-1", "alliance-1"]);
    const roster = selectFor(selects, schema.allianceMembers);
    const rosterWhere = dialect.sqlToQuery(roster?.where as SQL);
    expect(rosterWhere.sql).toContain("ashed_member_id");
    expect(rosterWhere.params).toEqual(["alliance-1", "m-1"]);
  });

  it("does not fall back to membership rank when the roster rank is null", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: null,
        status: "active",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.commanderId).toBe("cmdr-1");
    expect(ctx.actor.gameRank).toBeNull();
  });

  it("requires an active roster row for commander eligibility", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "Cmdr One",
        allianceRank: 4,
        status: "former",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBeNull();
  });

  it("falls back to the roster name when the hq display name is unsafe", async () => {
    const rows = baseRows();
    rows.set(schema.hqUsers, [
      { id: "hq-1", displayName: "user@example.com", ashedUserId: "a-1" },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.displayName).toBe("Cmdr One");
  });

  it("falls back to the link name when hq and roster names are unsafe", async () => {
    const rows = baseRows();
    rows.set(schema.hqUsers, [
      { id: "hq-1", displayName: "user@example.com", ashedUserId: "a-1" },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "user@example.com",
        allianceRank: 4,
        status: "active",
      },
    ]);
    rows.set(schema.hqUserCommanders, [
      {
        memberId: "m-1",
        commanderId: "cmdr-1",
        name: "Roster Name",
        primary: true,
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.displayName).toBe("Roster Name");
  });

  it("returns a null name when every source is unsafe", async () => {
    const rows = baseRows();
    rows.set(schema.hqUsers, [
      { id: "hq-1", displayName: "user@example.com", ashedUserId: "a-1" },
    ]);
    rows.set(schema.allianceMembers, [
      {
        ashedMemberId: "m-1",
        currentName: "user@example.com",
        allianceRank: 4,
        status: "active",
      },
    ]);
    rows.set(schema.hqUserCommanders, [
      {
        memberId: "m-1",
        commanderId: "cmdr-1",
        name: "user@example.com",
        primary: true,
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.displayName).toBeNull();
  });
});

describe("captureActivityContext — hq role vs credential conflict", () => {
  it("omits an ashed-sourced role when the session credential conflicts", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMemberships, [
      { name: "officer", source: "ashed" },
    ]);
    rows.set(schema.ashedCredentials, [{ ashedUserId: "ashed-other" }]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.hqRole).toBeNull();
  });

  it("omits an ashed-sourced role when the hq user has no ashed identity", async () => {
    const rows = baseRows();
    rows.set(schema.hqUsers, [
      { id: "hq-1", displayName: "Cmdr One", ashedUserId: null },
    ]);
    rows.set(schema.allianceMemberships, [
      { name: "officer", source: "ashed" },
    ]);
    rows.set(schema.ashedCredentials, [{ ashedUserId: "ashed-u-1" }]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.hqRole).toBeNull();
  });

  it("keeps an ashed-sourced role when the credential matches", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMemberships, [
      { name: "officer", source: "ashed" },
    ]);
    rows.set(schema.ashedCredentials, [{ ashedUserId: "ashed-u-1" }]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.hqRole).toBe("officer");
  });

  it("keeps an ashed-sourced role when no credential row exists", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMemberships, [
      { name: "officer", source: "ashed" },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.hqRole).toBe("officer");
  });

  it("keeps a manual role regardless of credential conflict", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMemberships, [
      { name: "officer", source: "manual" },
    ]);
    rows.set(schema.ashedCredentials, [{ ashedUserId: "ashed-other" }]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.hqRole).toBe("officer");
  });

  it("omits unknown custom role names and keeps rank independent", async () => {
    const rows = baseRows();
    rows.set(schema.allianceMemberships, [
      { name: "squad_lead", source: "manual" },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.actor.hqRole).toBeNull();
    expect(ctx.actor.gameRank).toBe("R4");
  });
});

describe("captureActivityContext — discord identity", () => {
  it("captures an unlinked discord actor with roster rank and no hq owner", async () => {
    const rows = new Map<unknown, Row[]>([
      [schema.alliances, [ALLIANCE]],
      [schema.discordHqLinks, []],
      [
        schema.discordMemberLinks,
        [{ ashedMemberId: "m-1", memberDisplayName: "Discord Cmdr" }],
      ],
      [
        schema.commanderAllianceMemberships,
        [{ memberId: "m-1", commanderId: "cmdr-9" }],
      ],
      [
        schema.allianceMembers,
        [
          {
            ashedMemberId: "m-1",
            currentName: "Discord Cmdr",
            allianceRank: 5,
            status: "active",
          },
        ],
      ],
    ]);
    const { tx, selects, executed } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "discord", discordUserId: "d-1" },
    });
    expect(ctx.channel).toBe("discord");
    expect(ctx.actor).toEqual({
      kind: "discord",
      hqUserId: null,
      discordUserId: "d-1",
      personalOwnerHqUserId: null,
      commanderId: "cmdr-9",
      displayName: "Discord Cmdr",
      hqRole: null,
      gameRank: "R5",
    });
    expect(lockKeys(executed)).toEqual(["activity:discord:d-1"]);
    expect(selectFor(selects, schema.sessions)).toBeUndefined();
    expect(selectFor(selects, schema.hqUsers)).toBeUndefined();
    expect(selectFor(selects, schema.hqUserCommanders)).toBeUndefined();
    expect(selectFor(selects, schema.hqMemberLinks)).toBeUndefined();
    expect(selectFor(selects, schema.allianceMemberships)).toBeUndefined();
  });

  it("captures a linked discord actor with hq name and role", async () => {
    const rows = new Map<unknown, Row[]>([
      [schema.alliances, [ALLIANCE]],
      [schema.discordHqLinks, [{ hqUserId: "hq-9" }]],
      [
        schema.hqUsers,
        [{ id: "hq-9", displayName: "HQ Nine", ashedUserId: null }],
      ],
      [schema.allianceMemberships, [{ name: "officer", source: "manual" }]],
      [
        schema.discordMemberLinks,
        [{ ashedMemberId: "m-1", memberDisplayName: "Discord Cmdr" }],
      ],
      [
        schema.commanderAllianceMemberships,
        [{ memberId: "m-1", commanderId: "cmdr-9" }],
      ],
      [
        schema.allianceMembers,
        [
          {
            ashedMemberId: "m-1",
            currentName: "Discord Cmdr",
            allianceRank: 4,
            status: "active",
          },
        ],
      ],
    ]);
    const { tx, executed, selects } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "discord", discordUserId: "d-1" },
    });
    expect(ctx.actor).toEqual({
      kind: "discord",
      hqUserId: "hq-9",
      discordUserId: "d-1",
      personalOwnerHqUserId: "hq-9",
      commanderId: "cmdr-9",
      displayName: "HQ Nine",
      hqRole: "officer",
      gameRank: "R4",
    });
    expect(lockKeys(executed)).toEqual([
      "activity:discord:d-1",
      "activity:hq:hq-9",
    ]);
    const linkSelect = selectFor(selects, schema.discordHqLinks);
    expect(linkSelect?.forMode).toBe("share");
    expect(selectFor(selects, schema.hqUserCommanders)).toBeUndefined();
    expect(selectFor(selects, schema.hqMemberLinks)).toBeUndefined();
  });

  it("never infers an hq owner from a matching commander name", async () => {
    const rows = new Map<unknown, Row[]>([
      [schema.alliances, [ALLIANCE]],
      [schema.discordHqLinks, []],
      [
        schema.discordMemberLinks,
        [{ ashedMemberId: "m-1", memberDisplayName: "Cmdr One" }],
      ],
      [
        schema.commanderAllianceMemberships,
        [{ memberId: "m-1", commanderId: "cmdr-1" }],
      ],
      [
        schema.allianceMembers,
        [
          {
            ashedMemberId: "m-1",
            currentName: "Cmdr One",
            allianceRank: 4,
            status: "active",
          },
        ],
      ],
    ]);
    const { tx, selects } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "discord", discordUserId: "d-1" },
    });
    expect(ctx.actor.hqUserId).toBeNull();
    expect(ctx.actor.personalOwnerHqUserId).toBeNull();
    expect(selectFor(selects, schema.hqUsers)).toBeUndefined();
  });

  it("omits commander and rank for multiple unlinked members", async () => {
    const rows = new Map<unknown, Row[]>([
      [schema.alliances, [ALLIANCE]],
      [schema.discordHqLinks, []],
      [
        schema.discordMemberLinks,
        [
          { ashedMemberId: "m-1", memberDisplayName: "One" },
          { ashedMemberId: "m-2", memberDisplayName: "Two" },
        ],
      ],
      [
        schema.commanderAllianceMemberships,
        [
          { memberId: "m-1", commanderId: "cmdr-1" },
          { memberId: "m-2", commanderId: "cmdr-2" },
        ],
      ],
      [
        schema.allianceMembers,
        [
          {
            ashedMemberId: "m-1",
            currentName: "One",
            allianceRank: 5,
            status: "active",
          },
          {
            ashedMemberId: "m-2",
            currentName: "Two",
            allianceRank: 2,
            status: "active",
          },
        ],
      ],
    ]);
    const { tx, selects } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "discord", discordUserId: "d-1" },
    });
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBeNull();
    const links = selectFor(selects, schema.discordMemberLinks);
    const linksWhere = dialect.sqlToQuery(links?.where as SQL);
    expect(linksWhere.params).toEqual(["d-1", "alliance-1"]);
    const cam = selectFor(selects, schema.commanderAllianceMemberships);
    const camWhere = dialect.sqlToQuery(cam?.where as SQL);
    expect(camWhere.sql).toContain("ashed_member_id");
    expect(camWhere.sql).toContain("is null");
    expect(camWhere.params).toEqual([
      "alliance-1",
      "m-1",
      "m-2",
      "active",
    ]);
  });

  it("maps a commander id only when it resolves uniquely", async () => {
    const rows = new Map<unknown, Row[]>([
      [schema.alliances, [ALLIANCE]],
      [schema.discordHqLinks, []],
      [
        schema.discordMemberLinks,
        [{ ashedMemberId: "m-1", memberDisplayName: "Discord Cmdr" }],
      ],
      [
        schema.commanderAllianceMemberships,
        [
          { memberId: "m-1", commanderId: "cmdr-9" },
          { memberId: "m-1", commanderId: "cmdr-10" },
        ],
      ],
      [
        schema.allianceMembers,
        [
          {
            ashedMemberId: "m-1",
            currentName: "Discord Cmdr",
            allianceRank: 5,
            status: "active",
          },
        ],
      ],
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "discord", discordUserId: "d-1" },
    });
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBe("R5");
  });
});

describe("captureActivityContext — scope resolution", () => {
  it("resolves an ashed alliance reference only by ashed id", async () => {
    const rows = baseRows();
    const { tx, selects } = makeTx(rows);
    const ctx = await capture(tx, {
      alliance: { kind: "ashed", id: "ashed-al-9" },
    });
    expect(ctx.scope.allianceId).toBe("alliance-1");
    const allianceSelect = selectFor(selects, schema.alliances);
    const { sql, params } = dialect.sqlToQuery(allianceSelect?.where as SQL);
    expect(sql).toContain("ashed_alliance_id");
    expect(params).toEqual(["ashed-al-9"]);
  });

  it("resolves an hq reference only by canonical id", async () => {
    const { tx, selects } = makeTx(baseRows());
    await capture(tx, { alliance: { kind: "hq", id: "alliance-1" } });
    const allianceSelect = selectFor(selects, schema.alliances);
    const { sql, params } = dialect.sqlToQuery(allianceSelect?.where as SQL);
    expect(sql).toContain('"alliances"."id"');
    expect(params).toEqual(["alliance-1"]);
  });

  it("rejects an unknown alliance id rather than guessing by tag or name", async () => {
    const rows = baseRows();
    rows.set(schema.alliances, []);
    const { tx } = makeTx(rows);
    await expectValidation(
      capture(tx, { alliance: { kind: "hq", id: "alliance-missing" } }),
    );
  });

  it("rejects an unknown alliance reference kind", async () => {
    const { tx } = makeTx(baseRows());
    await expectValidation(
      capture(tx, {
        alliance: { kind: "other", id: "x" } as unknown as ActivityAllianceReference,
      }),
    );
  });

  it("sanitizes tag and name labels without failing", async () => {
    const rows = baseRows();
    rows.set(schema.alliances, [
      {
        id: "alliance-1",
        server: 1203,
        tag: ` ${"T".repeat(40)} `,
        name: "user@example.com",
      },
    ]);
    const { tx } = makeTx(rows);
    const ctx = await capture(tx);
    expect(ctx.scope.allianceTag).toBe("T".repeat(32));
    expect(ctx.scope.allianceName).toBeNull();
  });

  it("returns a null scope for an account with no alliance", async () => {
    const rows = baseRows();
    rows.set(schema.sessions, [
      { hqUserId: "hq-1", currentAllianceId: null, expiresAt: SESSION.expiresAt },
    ]);
    const principal: ActivityPrincipal = {
      ...PRINCIPAL,
      currentAllianceId: null,
    };
    const { tx, selects } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "web", principal },
      alliance: null,
    });
    expect(ctx.scope).toEqual({
      allianceId: null,
      serverNumber: null,
      allianceTag: null,
      allianceName: null,
    });
    expect(ctx.actor.hqRole).toBeNull();
    expect(ctx.actor.commanderId).toBeNull();
    expect(ctx.actor.gameRank).toBeNull();
    expect(selectFor(selects, schema.allianceMemberships)).toBeUndefined();
    expect(selectFor(selects, schema.allianceMembers)).toBeUndefined();
  });

  it("rejects an explicit acting member when scope is null", async () => {
    const rows = baseRows();
    rows.set(schema.sessions, [
      { hqUserId: "hq-1", currentAllianceId: null, expiresAt: SESSION.expiresAt },
    ]);
    const principal: ActivityPrincipal = {
      ...PRINCIPAL,
      currentAllianceId: null,
    };
    const { tx } = makeTx(rows);
    await expectValidation(
      capture(tx, {
        identity: { kind: "web", principal },
        alliance: null,
        actingMemberId: "m-1",
      }),
    );
  });
});

describe("captureActivityContext — session and hq binding", () => {
  it("rejects a missing session", async () => {
    const rows = baseRows();
    rows.set(schema.sessions, []);
    const { tx } = makeTx(rows);
    await expectValidation(capture(tx));
  });

  it("rejects an expired session", async () => {
    const rows = baseRows();
    rows.set(schema.sessions, [
      { ...SESSION, expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    ]);
    const { tx } = makeTx(rows);
    await expectValidation(capture(tx));
  });

  it("rejects a session bound to a different hq user", async () => {
    const rows = baseRows();
    rows.set(schema.sessions, [{ ...SESSION, hqUserId: "hq-other" }]);
    const { tx } = makeTx(rows);
    await expectValidation(capture(tx));
  });

  it("rejects a session bound to a different current alliance", async () => {
    const rows = baseRows();
    rows.set(schema.sessions, [
      { ...SESSION, currentAllianceId: "alliance-other" },
    ]);
    const { tx } = makeTx(rows);
    await expectValidation(capture(tx));
  });

  it("rejects a deleted hq user", async () => {
    const rows = baseRows();
    rows.set(schema.hqUsers, []);
    const { tx } = makeTx(rows);
    await expectValidation(capture(tx));
  });

  it("rejects an invalid principal id", async () => {
    const { tx } = makeTx(baseRows());
    await expectValidation(
      capture(tx, {
        identity: {
          kind: "web",
          principal: { ...PRINCIPAL, hqUserId: "has space" },
        },
      }),
    );
  });
});

describe("captureActivityContext — automation identity", () => {
  it("captures scope with no human identity and no identity queries", async () => {
    const rows = new Map<unknown, Row[]>([[schema.alliances, [ALLIANCE]]]);
    const { tx, selects, executed } = makeTx(rows);
    const ctx = await capture(tx, {
      identity: { kind: "automation" },
      method: "sync",
    });
    expect(ctx.channel).toBe("automation");
    expect(ctx.method).toBe("sync");
    expect(ctx.scope.allianceId).toBe("alliance-1");
    expect(ctx.actor).toEqual({
      kind: "automation",
      hqUserId: null,
      discordUserId: null,
      personalOwnerHqUserId: null,
      commanderId: null,
      displayName: null,
      hqRole: null,
      gameRank: null,
    });
    expect(executed).toHaveLength(0);
    expect(selects.map((select) => select.table)).toEqual([schema.alliances]);
  });

  it("rejects an acting member supplied for an automation identity", async () => {
    const { tx } = makeTx(new Map([[schema.alliances, [ALLIANCE]]]));
    await expectValidation(
      capture(tx, {
        identity: { kind: "automation" },
        actingMemberId: "m-1",
      }),
    );
  });
});
