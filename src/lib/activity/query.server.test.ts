import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityEventRecord } from "@/lib/db/schema";

import type { ActivityPrincipal } from "./access.server";
import { activityCatalog } from "./catalog.shared";

const state = vi.hoisted(() => ({
  whereArgs: [] as unknown[],
  orderArgs: [] as unknown[],
  limitArgs: [] as number[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => chain(),
      selectDistinctOn: () => chain(),
      selectDistinct: () => chain(),
    }),
  };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/rbac/context", () => ({ getRbacContext: vi.fn() }));
vi.mock("@/lib/rbac/require-permission", () => ({
  requirePlatformMaintainer: vi.fn(),
  requireSessionPermission: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

function chain() {
  const link: Record<string, unknown> = {
    from: () => link,
    where: (arg: unknown) => {
      state.whereArgs.push(arg);
      return link;
    },
    orderBy: (...args: unknown[]) => {
      state.orderArgs.push(args);
      return link;
    },
    limit: (n: number) => {
      state.limitArgs.push(n);
      return Promise.resolve(state.rows);
    },
  };
  return link;
}

import {
  queryActivityFilterOptions,
  queryActivityHead,
  queryActivityPage,
  type ActivityFeedQueryInput,
} from "./query.server";
import { ActivityReadError } from "./access.server";

const dialect = new PgDialect();

const OFFICER: ActivityPrincipal = {
  hqUserId: "officer-1",
  sessionId: "session-1",
  currentAllianceId: "alliance-1",
  permissions: new Set(["hq:audit:read"]),
  isPlatformMaintainer: false,
  scopeFence: JSON.stringify(["officer-1", "alliance-1"]),
};

const MAINTAINER: ActivityPrincipal = {
  hqUserId: "maintainer-1",
  sessionId: "session-2",
  currentAllianceId: null,
  permissions: new Set(["hq:admin"]),
  isPlatformMaintainer: true,
  scopeFence: JSON.stringify(["maintainer-1", null]),
};

const MEMBER: ActivityPrincipal = {
  hqUserId: "member-1",
  sessionId: "session-3",
  currentAllianceId: "alliance-1",
  permissions: new Set<string>(),
  isPlatformMaintainer: false,
  scopeFence: JSON.stringify(["member-1", "alliance-1"]),
};

function makeRow(overrides: Partial<ActivityEventRecord> = {}) {
  return {
    record: {
      id: "evt-1",
      schemaVersion: 1,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      occurredAt: "2026-09-29T12:00:00.000000Z",
      recordedAt: "2026-09-29T12:00:01Z",
      allianceId: "alliance-1",
      actorKind: "hq",
      originalHqUserId: "actor-1",
      originalDiscordUserId: null,
      personalOwnerHqUserId: "actor-1",
      actorCommanderId: null,
      actorDisplayName: "Cmdr Actor",
      actorHqRole: "officer",
      actorGameRank: "R4",
      serverNumber: "1203",
      allianceTag: "TST",
      allianceName: "Test Alliance",
      channel: "web",
      method: "manual",
      severity: "update",
      visibilityClass: "alliance",
      resourceKind: "member",
      resourceId: "res-1",
      payload: { value: "1" },
      sourceNamespace: "e2e",
      sourceKey: "k1",
      contentHash: "h1",
      historical: false,
      historicalCurrentLabels: false,
      ...overrides,
    } as ActivityEventRecord,
    cursorTime: "2026-09-29T12:00:00.123456Z",
  };
}

function pageQuery(
  overrides: Partial<ActivityFeedQueryInput> = {},
): ActivityFeedQueryInput {
  return { view: "page", limit: 50, ...overrides };
}

async function expectReadError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ActivityReadError);
    expect((error as ActivityReadError).code).toBe(code);
    expect((error as ActivityReadError).status).toBe(status);
    return;
  }
  throw new Error(`expected ActivityReadError ${code}`);
}

function renderedWhere(index = 0) {
  const where = state.whereArgs[index] as SQL;
  return dialect.sqlToQuery(where);
}

describe("queryActivityPage", () => {
  beforeEach(() => {
    state.whereArgs = [];
    state.orderArgs = [];
    state.limitArgs = [];
    state.rows = [];
  });

  it("restricts personal scope to the owner before limit", async () => {
    state.rows = [makeRow({ personalOwnerHqUserId: "member-1" })];
    const page = await queryActivityPage(MEMBER, "personal", pageQuery());
    const { sql, params } = renderedWhere();
    expect(sql).toContain("personal_owner_hq_user_id");
    expect(params).toContain("member-1");
    expect(sql).toContain("schema_version");
    expect(state.orderArgs[0]).toHaveLength(2);
    expect(state.limitArgs[0]).toBe(51);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].occurredAt).toBe("2026-09-29T12:00:00.123456Z");
    expect(page.scopeFence).toBe(MEMBER.scopeFence);
  });

  it("restricts alliance scope to the selected tenant and alliance visibility", async () => {
    state.rows = [makeRow()];
    await queryActivityPage(OFFICER, "alliance", pageQuery());
    const { sql, params } = renderedWhere();
    expect(params).toContain("alliance-1");
    expect(sql).toContain("alliance_id");
    expect(sql).toContain("visibility_class");
    expect(sql.match(/'private'/g)).toBeNull();
    const allianceKeys = Object.entries(activityCatalog)
      .filter(([, entry]) => entry.visibility === "alliance")
      .map(([key]) => key);
    for (const key of allianceKeys) {
      expect(params).toContain(key);
    }
    const privateKeys = Object.entries(activityCatalog)
      .filter(([, entry]) => entry.visibility === "private")
      .map(([key]) => key);
    for (const key of privateKeys) {
      expect(params).not.toContain(key);
    }
  });

  it("excludes unregistered events by enumerating the catalog in SQL", async () => {
    state.rows = [makeRow()];
    await queryActivityPage(MAINTAINER, "global", pageQuery());
    const { params } = renderedWhere();
    for (const key of Object.keys(activityCatalog)) {
      expect(params).toContain(key);
    }
  });

  it("binds timestamp filters as exact strings without Date conversion", async () => {
    state.rows = [];
    await queryActivityPage(
      MEMBER,
      "personal",
      pageQuery({
        from: "2026-09-29T00:00:00.123456Z",
        to: "2026-09-30T00:00:00.654321Z",
      }),
    );
    const { sql, params } = renderedWhere();
    expect(sql).toContain("::text::timestamptz");
    expect(params).toContain("2026-09-29T00:00:00.123456Z");
    expect(params).toContain("2026-09-30T00:00:00.654321Z");
  });

  it("binds actor and attribute filters in SQL", async () => {
    state.rows = [];
    await queryActivityPage(
      OFFICER,
      "alliance",
      pageQuery({
        actor: "hq:actor-9",
        channel: "discord",
        kind: "change",
        category: "thp",
      }),
    );
    const { sql, params } = renderedWhere();
    expect(sql).toContain("original_hq_user_id");
    expect(sql).toContain("^[0-9]{12,16}$");
    expect(sql).toContain("position('@'");
    expect(params).toContain("hq:actor-9");
    expect(params).toContain("discord");
    expect(params).toContain("change");
    expect(params).toContain("thp");
  });

  it("issues a stable cursor and replays the boundary verbatim", async () => {
    state.rows = [makeRow(), makeRow({ id: "evt-2" }), makeRow({ id: "evt-3" })];
    const page = await queryActivityPage(
      OFFICER,
      "alliance",
      pageQuery({ limit: 2 }),
    );
    expect(page.items.map((item) => item.id)).toEqual(["evt-1", "evt-2"]);
    const cursor = JSON.parse(page.nextCursor!);
    expect(cursor.version).toBe(1);
    expect(cursor.scope).toBe("alliance");
    expect(cursor.scopeFence).toBe(OFFICER.scopeFence);
    expect(cursor.occurredAt).toBe("2026-09-29T12:00:00.123456Z");
    expect(cursor.id).toBe("evt-2");

    state.rows = [makeRow({ id: "evt-3" })];
    const page2 = await queryActivityPage(
      OFFICER,
      "alliance",
      pageQuery({ limit: 2, cursor: page.nextCursor! }),
    );
    const { sql, params } = renderedWhere(1);
    expect(sql).toContain("::text::timestamptz");
    expect(params).toContain("2026-09-29T12:00:00.123456Z");
    expect(params).toContain("evt-2");
    expect(page2.items[0].id).toBe("evt-3");
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects cursors minted for another scope or principal", async () => {
    state.rows = [makeRow(), makeRow({ id: "evt-2" })];
    const page = await queryActivityPage(
      OFFICER,
      "alliance",
      pageQuery({ limit: 1 }),
    );
    const cursor = JSON.parse(page.nextCursor!);

    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({
          limit: 1,
          cursor: JSON.stringify({ ...cursor, scope: "global" }),
        }),
      ),
      "forbidden",
      403,
    );

    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({
          limit: 1,
          cursor: JSON.stringify({
            ...cursor,
            scopeFence: JSON.stringify(["other-user", "alliance-1"]),
          }),
        }),
      ),
      "forbidden",
      403,
    );

    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({
          limit: 1,
          cursor: JSON.stringify({ ...cursor, key: "0".repeat(64) }),
        }),
      ),
      "invalid",
      400,
    );

    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({
          limit: 1,
          cursor: JSON.stringify({
            ...cursor,
            occurredAt: "2026-09-29T12:00:00.123Z",
          }),
        }),
      ),
      "invalid",
      400,
    );

    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({
          limit: 1,
          cursor: JSON.stringify({
            ...cursor,
            occurredAt: "0000-01-01T00:00:00.000000Z",
          }),
        }),
      ),
      "invalid",
      400,
    );

    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({ limit: 1, cursor: "not json" }),
      ),
      "invalid",
      400,
    );
  });

  it("rejects cursor filter keys minted for different filters", async () => {
    state.rows = [makeRow(), makeRow({ id: "evt-2" })];
    const page = await queryActivityPage(
      OFFICER,
      "alliance",
      pageQuery({ limit: 1, kind: "change" }),
    );
    await expectReadError(
      queryActivityPage(
        OFFICER,
        "alliance",
        pageQuery({ limit: 1, kind: "usage", cursor: page.nextCursor! }),
      ),
      "invalid",
      400,
    );
  });

  it("blocks disallowed scopes before touching the database", async () => {
    await expectReadError(
      queryActivityPage(MEMBER, "alliance", pageQuery()),
      "forbidden",
      403,
    );
    await expectReadError(
      queryActivityPage(OFFICER, "global", pageQuery()),
      "forbidden",
      403,
    );
    expect(state.whereArgs).toHaveLength(0);
  });
});

describe("queryActivityHead", () => {
  beforeEach(() => {
    state.whereArgs = [];
    state.orderArgs = [];
    state.limitArgs = [];
    state.rows = [];
  });

  it("selects only id and exact occurredAt with the same predicates", async () => {
    state.rows = [{ id: "evt-9", occurredAt: "2026-09-29T12:00:00.123456Z" }];
    const head = await queryActivityHead(
      OFFICER,
      "alliance",
      pageQuery({ view: "head" }),
    );
    const { params } = renderedWhere();
    expect(params).toContain("alliance-1");
    expect(state.limitArgs[0]).toBe(1);
    expect(head.head).toEqual({
      id: "evt-9",
      occurredAt: "2026-09-29T12:00:00.123456Z",
    });
  });
});

describe("queryActivityFilterOptions", () => {
  beforeEach(() => {
    state.whereArgs = [];
    state.orderArgs = [];
    state.limitArgs = [];
    state.rows = [];
  });

  it("scopes actor suggestions through the authorized predicate", async () => {
    state.rows = [{ value: "hq:actor-1", label: "Cmdr Actor" }];
    const result = await queryActivityFilterOptions(
      OFFICER,
      "alliance",
      pageQuery({ view: "filters" }),
    );
    const { params } = renderedWhere();
    expect(params).toContain("alliance-1");
    expect(state.limitArgs[0]).toBe(100);
    expect(result.options.actors).toEqual([
      { value: "hq:actor-1", label: "Cmdr Actor" },
    ]);
    expect(result.options.servers).toEqual([]);
    expect(result.options.alliances).toEqual([]);
    expect(result.options.categories).toContain("thp");
    expect(result.options.channels).toContain("web");
  });

  it("omits actor suggestions on personal scope", async () => {
    state.rows = [];
    const result = await queryActivityFilterOptions(
      MEMBER,
      "personal",
      pageQuery({ view: "filters" }),
    );
    expect(result.options.actors).toEqual([]);
    expect(result.options.servers).toEqual([]);
  });

  it("sanitizes suggestion labels before returning them", async () => {
    state.rows = [{ value: "hq:actor-2", label: "leak@e2e.test" }];
    const result = await queryActivityFilterOptions(
      OFFICER,
      "alliance",
      pageQuery({ view: "filters" }),
    );
    expect(result.options.actors).toEqual([
      { value: "hq:actor-2", label: null },
    ]);
  });

  it("drops actor suggestions whose keys are a game UID or an email", async () => {
    const uid = "1234567890123456";
    state.rows = [
      { value: `hq:${uid}`, label: "Cmdr Actor" },
      { value: "discord:user@e2e.test", label: "Discord" },
      { value: "hq:actor-3", label: "Kept" },
    ];
    const result = await queryActivityFilterOptions(
      OFFICER,
      "alliance",
      pageQuery({ view: "filters" }),
    );
    expect(result.options.actors).toEqual([
      { value: "hq:actor-3", label: "Kept" },
    ]);
    expect(JSON.stringify(result)).not.toContain(uid);
    expect(JSON.stringify(result)).not.toContain("user@e2e.test");
  });

  it("binds q against sanitized SQL expressions, not raw columns", async () => {
    state.rows = [];
    await queryActivityFilterOptions(
      OFFICER,
      "alliance",
      pageQuery({ view: "filters", q: "100%" }),
    );
    const { sql, params } = renderedWhere();
    expect(sql.toLowerCase()).toContain("case when");
    expect(sql.toLowerCase()).toContain("btrim");
    expect(sql.toLowerCase().indexOf("case when")).toBeLessThan(
      sql.toLowerCase().indexOf("ilike"),
    );
    expect(params).toContain("%100\\%%");
  });
});
