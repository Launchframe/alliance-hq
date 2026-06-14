import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildAuditLogSearchParams,
  escapeLikePrefix,
  normalizeAuditActionFilter,
  parseAuditLogQueryParams,
} from "@/lib/admin/audit-query";
import { buildAuditLogWhere } from "@/lib/admin/audit-query-server";

const dialect = new PgDialect();

function whereSql(filters: Parameters<typeof buildAuditLogWhere>[0]) {
  const where = buildAuditLogWhere(filters);
  if (!where) return null;
  return dialect.sqlToQuery(where);
}

describe("escapeLikePrefix", () => {
  it("escapes SQL LIKE metacharacters", () => {
    expect(escapeLikePrefix("video%_\\")).toBe("video\\%\\_\\\\");
  });
});

describe("normalizeAuditActionFilter", () => {
  it("treats trailing .* as prefix", () => {
    expect(normalizeAuditActionFilter("bff.entity.*")).toEqual({
      kind: "prefix",
      value: "bff.entity",
    });
  });

  it("treats trailing .* as prefix for nested actions", () => {
    expect(normalizeAuditActionFilter("video.*")).toEqual({
      kind: "prefix",
      value: "video",
    });
  });

  it("treats a trailing single * as prefix", () => {
    expect(normalizeAuditActionFilter("video*")).toEqual({
      kind: "prefix",
      value: "video",
    });
  });

  it("uses exact match otherwise", () => {
    expect(normalizeAuditActionFilter("video.upload")).toEqual({
      kind: "exact",
      value: "video.upload",
    });
  });
});

describe("parseAuditLogQueryParams", () => {
  it("defaults limit to 100 and caps at 500", () => {
    const defaults = parseAuditLogQueryParams(new URLSearchParams());
    expect(defaults.ok).toBe(true);
    if (defaults.ok) {
      expect(defaults.filters.limit).toBe(100);
    }

    const capped = parseAuditLogQueryParams(new URLSearchParams("limit=999"));
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.filters.limit).toBe(500);
    }

    const invalid = parseAuditLogQueryParams(new URLSearchParams("limit=0"));
    expect(invalid.ok).toBe(true);
    if (invalid.ok) {
      expect(invalid.filters.limit).toBe(100);
    }
  });

  it("parses composable filters", () => {
    const result = parseAuditLogQueryParams(
      new URLSearchParams(
        "allianceId=ally-1&action=bff.entity.*&hqUserId=u1&since=2026-01-01T00:00:00.000Z&limit=50",
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filters.allianceId).toBe("ally-1");
      expect(result.filters.action).toBe("bff.entity.*");
      expect(result.filters.hqUserId).toBe("u1");
      expect(result.filters.since?.toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );
      expect(result.filters.limit).toBe(50);
    }
  });

  it("rejects invalid since date", () => {
    const result = parseAuditLogQueryParams(
      new URLSearchParams("since=not-a-date"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("since");
    }
  });

  it("rejects invalid until date", () => {
    const result = parseAuditLogQueryParams(
      new URLSearchParams("until=not-a-date"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("until");
    }
  });

  it("rejects since after until", () => {
    const result = parseAuditLogQueryParams(
      new URLSearchParams(
        "since=2026-06-02T00:00:00.000Z&until=2026-06-01T00:00:00.000Z",
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("since");
    }
  });

  it("rejects empty prefix action filters", () => {
    const result = parseAuditLogQueryParams(new URLSearchParams("action=.*"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("action");
    }
  });
});

describe("buildAuditLogWhere", () => {
  it("returns undefined when no filters are set", () => {
    expect(buildAuditLogWhere({ limit: 100 })).toBeUndefined();
  });

  it("matches HQ and Ashed alliance ids when allianceMatchIds is set", () => {
    const query = whereSql({
      allianceMatchIds: ["hq-1", "ashed-1"],
      limit: 100,
    });
    expect(query?.sql).toContain("in");
    expect(query?.params).toContain("hq-1");
    expect(query?.params).toContain("ashed-1");
  });

  it("combines alliance, user, action, and date predicates", () => {
    const query = whereSql({
      allianceId: "ally-1",
      hqUserId: "user-1",
      action: "video.*",
      since: new Date("2026-01-01T00:00:00.000Z"),
      until: new Date("2026-01-02T00:00:00.000Z"),
      limit: 100,
    });
    expect(query?.sql).toContain('"audit_log"."alliance_id" =');
    expect(query?.sql).toContain('"audit_log"."hq_user_id" =');
    expect(query?.sql).toContain('"audit_log"."action" like');
    expect(query?.sql).toContain("escape");
    expect(query?.params).toContain("video%");
    expect(query?.params).toContain("ally-1");
    expect(query?.params).toContain("user-1");
  });

  it("uses exact match for non-prefix actions", () => {
    const query = whereSql({
      action: "bff.integration",
      limit: 100,
    });
    expect(query?.sql).toContain('"audit_log"."action" =');
    expect(query?.params).toContain("bff.integration");
  });

  it("escapes metacharacters in prefix actions", () => {
    const query = whereSql({
      action: "video%.*",
      limit: 100,
    });
    expect(query?.params).toContain("video\\%%");
  });
});

describe("buildAuditLogSearchParams", () => {
  it("serializes filters for fetch", () => {
    const qs = buildAuditLogSearchParams({
      allianceId: "a1",
      action: "video.*",
      hqUserId: "u1",
      limit: 200,
      since: new Date("2026-01-01T00:00:00.000Z"),
      until: new Date("2026-01-02T00:00:00.000Z"),
    });
    const params = new URLSearchParams(qs);
    expect(params.get("allianceId")).toBe("a1");
    expect(params.get("action")).toBe("video.*");
    expect(params.get("hqUserId")).toBe("u1");
    expect(params.get("limit")).toBe("200");
    expect(params.get("since")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("until")).toBe("2026-01-02T00:00:00.000Z");
  });
});
