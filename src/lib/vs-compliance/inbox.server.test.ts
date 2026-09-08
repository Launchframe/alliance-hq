import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const state = vi.hoisted(() => ({ results: [] as unknown[][], where: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => () => "Cumprimento dos mínimos de VS" }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { schema, getDb: () => ({ select: () => {
    const rows = state.results.shift() ?? [];
    const query = Object.assign(Promise.resolve(rows), { from: () => query, innerJoin: () => query, limit: () => query, orderBy: () => query, where: (condition: unknown) => { state.where.push(condition); return query; } });
    return query;
  } }) };
});
import { loadReminderInboxForUser } from "@/lib/eur/satisfaction";
const item = { id: "item", allianceId: "tenant", kind: "vs_compliance", title: "VS compliance", body: "Private explanation must never be projected", href: "/vs-compliance", resourceId: "event", requiredPermission: "vs_compliance:read", createdAt: new Date(), active: 1 };
beforeEach(() => { state.results = [[], [item], [{ maintainer: 0 }], [{ roleName: "officer" }]]; state.where = []; });

describe("private discipline inbox projection", () => {
  it("returns only localized generic summaries for actual leadership", async () => {
    const rows = await loadReminderInboxForUser({ hqUserId: "officer", allianceId: "tenant", permissions: new Set(["vs_compliance:read"]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Cumprimento dos mínimos de VS", body: null, href: "/vs-compliance" });
    expect(JSON.stringify(rows)).not.toContain("Private explanation");
  });
  it("does not admit data-entry through members:write or an accidentally granted discipline permission", async () => {
    state.results[3] = [{ roleName: "data_entry" }];
    expect(await loadReminderInboxForUser({ hqUserId: "data-entry", allianceId: "tenant", permissions: new Set(["members:write", "vs_compliance:read"]) })).toEqual([]);
  });
  it("keeps dismissal identity separate from the verified canonical permission principal", async () => {
    await loadReminderInboxForUser({ hqUserId: "browser-user", principalHqUserId: "canonical", allianceId: "tenant", permissions: new Set(["vs_compliance:read"]) });
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(state.where[0] as SQL).params).toContain("browser-user");
    expect(dialect.sqlToQuery(state.where.at(-1) as SQL).params).toContain("canonical");
  });
  it("supports the verified platform override without granting that power from a permission string alone", async () => {
    state.results[2] = [{ maintainer: 1 }]; state.results[3] = [];
    expect(await loadReminderInboxForUser({ hqUserId: "admin", allianceId: "tenant", permissions: new Set(["hq:admin"]) })).toHaveLength(1);
    state.results = [[], [item], [{ maintainer: 0 }], []];
    expect(await loadReminderInboxForUser({ hqUserId: "member", allianceId: "tenant", permissions: new Set(["hq:admin"]) })).toEqual([]);
  });
});
