import { describe, expect, it } from "vitest";

import {
  buildAuditLogSearchParams,
  normalizeAuditActionFilter,
  parseAuditLogQueryParams,
} from "@/lib/admin/audit-query";

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

  it("uses exact match otherwise", () => {
    expect(normalizeAuditActionFilter("video.upload")).toEqual({
      kind: "exact",
      value: "video.upload",
    });
  });
});

describe("parseAuditLogQueryParams", () => {
  it("defaults limit to 100 and caps at 500", () => {
    expect(parseAuditLogQueryParams(new URLSearchParams()).ok).toBe(true);
    if (parseAuditLogQueryParams(new URLSearchParams()).ok) {
      expect(
        parseAuditLogQueryParams(new URLSearchParams()).filters.limit,
      ).toBe(100);
    }

    const capped = parseAuditLogQueryParams(new URLSearchParams("limit=999"));
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.filters.limit).toBe(500);
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
});

describe("buildAuditLogSearchParams", () => {
  it("serializes filters for fetch", () => {
    const qs = buildAuditLogSearchParams({
      allianceId: "a1",
      action: "video.*",
      limit: 200,
      since: new Date("2026-01-01T00:00:00.000Z"),
    });
    const params = new URLSearchParams(qs);
    expect(params.get("allianceId")).toBe("a1");
    expect(params.get("action")).toBe("video.*");
    expect(params.get("limit")).toBe("200");
    expect(params.get("since")).toBe("2026-01-01T00:00:00.000Z");
  });
});
