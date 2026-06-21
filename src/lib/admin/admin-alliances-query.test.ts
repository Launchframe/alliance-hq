import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildAdminAlliancesQuery,
} from "@/lib/admin/admin-alliances-query.server";
import {
  buildAdminAlliancesSearchParams,
  parseAdminAlliancesQueryParams,
  type AdminAlliancesQueryParams,
} from "@/lib/admin/admin-alliances-query.shared";

const dialect = new PgDialect();

function whereSql(params: AdminAlliancesQueryParams) {
  const query = buildAdminAlliancesQuery(params);
  if (!query.where) return null;
  return dialect.sqlToQuery(query.where);
}

describe("parseAdminAlliancesQueryParams", () => {
  it("defaults limit to 25 and offset to 0", () => {
    const result = parseAdminAlliancesQueryParams(new URLSearchParams());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params).toEqual({
        q: undefined,
        operatingMode: "all",
        sort: "name",
        order: "asc",
        limit: 25,
        offset: 0,
      });
    }
  });

  it("caps limit at 500", () => {
    const result = parseAdminAlliancesQueryParams(
      new URLSearchParams("limit=999"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.limit).toBe(500);
    }
  });

  it("parses composable filters", () => {
    const result = parseAdminAlliancesQueryParams(
      new URLSearchParams(
        "q=lfgo&operatingMode=native&sort=memberCount&order=desc&limit=50&offset=25",
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params).toEqual({
        q: "lfgo",
        operatingMode: "native",
        sort: "memberCount",
        order: "desc",
        limit: 50,
        offset: 25,
      });
    }
  });

  it("rejects invalid operatingMode", () => {
    const result = parseAdminAlliancesQueryParams(
      new URLSearchParams("operatingMode=invalid"),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid sort", () => {
    const result = parseAdminAlliancesQueryParams(
      new URLSearchParams("sort=createdAt"),
    );
    expect(result.ok).toBe(false);
  });
});

describe("buildAdminAlliancesSearchParams", () => {
  it("omits default values", () => {
    const qs = buildAdminAlliancesSearchParams({
      operatingMode: "all",
      sort: "name",
      order: "asc",
      limit: 25,
      offset: 0,
    });
    expect(qs).toBe("");
  });

  it("serializes non-default filters", () => {
    const qs = buildAdminAlliancesSearchParams({
      q: "lfgo",
      operatingMode: "native",
      sort: "rolesSyncedAt",
      order: "desc",
      limit: 50,
      offset: 10,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("lfgo");
    expect(params.get("operatingMode")).toBe("native");
    expect(params.get("sort")).toBe("rolesSyncedAt");
    expect(params.get("order")).toBe("desc");
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("10");
  });
});

describe("buildAdminAlliancesQuery", () => {
  it("filters native operating mode", () => {
    const sql = whereSql({
      operatingMode: "native",
      sort: "name",
      order: "asc",
      limit: 25,
      offset: 0,
    });
    expect(sql?.sql).toContain("operating_mode");
    expect(sql?.params).toContain("native");
  });

  it("filters ashed operating mode", () => {
    const sql = whereSql({
      operatingMode: "ashed",
      sort: "name",
      order: "asc",
      limit: 25,
      offset: 0,
    });
    expect(sql?.params).toContain("ashed");
  });

  it("adds escaped search across alliance fields", () => {
    const sql = whereSql({
      q: "lf%go",
      operatingMode: "all",
      sort: "name",
      order: "asc",
      limit: 25,
      offset: 0,
    });
    expect(sql?.sql).toContain("ilike");
    expect(sql?.params).toContain("%lf\\%go%");
  });

  it("uses member count subquery for sort", () => {
    const query = buildAdminAlliancesQuery({
      operatingMode: "all",
      sort: "memberCount",
      order: "desc",
      limit: 25,
      offset: 0,
    });
    const orderSql = dialect.sqlToQuery(query.orderBy as Parameters<
      typeof dialect.sqlToQuery
    >[0]);
    expect(orderSql.sql).toContain("count");
    expect(orderSql.sql).toContain("alliance_memberships");
    expect(query.order).toBe("desc");
  });

  it("uses rolesSyncedAt column for sort", () => {
    const query = buildAdminAlliancesQuery({
      operatingMode: "all",
      sort: "rolesSyncedAt",
      order: "asc",
      limit: 25,
      offset: 0,
    });
    expect(query.orderBy).toBeDefined();
    expect(query.limit).toBe(25);
    expect(query.offset).toBe(0);
  });
});
