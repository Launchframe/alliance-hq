import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { configureCalendarTarget, saveCalendarPreferences } from "./repository.server";
import { calendarFeed, calendarFeedLink } from "./feed.server";
import { loadCalendarSettings } from "./settings.server";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
const owner = randomUUID(), allianceId = randomUUID();
let targetId = "", token = "";
const origin = process.env.CALENDAR_APP_ORIGIN;

describe.skipIf(process.env.CALENDAR_DB_TEST !== "1")("calendar feed capability lifecycle", () => {
  beforeAll(async () => {
    const url = process.env.E2E_DATABASE_URL ?? "";
    if (!url.includes("/alliance_hq_calendar_e2e_") || url !== process.env.DATABASE_URL || url !== process.env.LOCAL_DATABASE_URL) throw new Error("Dedicated calendar test database required");
    process.env.CALENDAR_APP_ORIGIN = "https://example.test";
    const db = getDb();
    const [server] = await db.select().from(schema.gameServers).where(eq(schema.gameServers.serverNumber, 0));
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "member"));
    await db.insert(schema.hqUsers).values({ id: owner, email: `${owner}@example.test` });
    await db.insert(schema.alliances).values({ id: allianceId, slug: allianceId, name: "Calendar test", tag: "CAL", gameServerId: server.id, gameServerNumber: 0 });
    await db.insert(schema.allianceMemberships).values({ id: randomUUID(), hqUserId: owner, allianceId, roleId: role.id, source: "manual", status: "active" });
    await db.insert(schema.regularEventScheduleRules).values({ id: randomUUID(), allianceId, eventKey: "zombie_siege", scheduleKind: "once", oneShotDates: [addCalendarDays(getServerCalendarDate(), 1)], anchorTimeSt: "20:00" });
    await saveCalendarPreferences(owner, { alerts: [10, 1], locale: "pt-BR", timezone: "America/Sao_Paulo" }, 0);
    targetId = (await configureCalendarTarget(owner, { allianceId, provider: "apple", enabled: true, sources: ["regular"], version: 0 })).id;
    token = new URL(await calendarFeedLink(owner, targetId)).searchParams.get("token")!;
  });
  afterAll(async () => {
    if (origin === undefined) delete process.env.CALENDAR_APP_ORIGIN; else process.env.CALENDAR_APP_ORIGIN = origin;
    await getDb().delete(schema.alliances).where(eq(schema.alliances.id, allianceId));
    await getDb().delete(schema.hqUsers).where(eq(schema.hqUsers.id, owner));
  });
  it("exports a subscription with two alarms and stable private revalidation", async () => {
    const first = await calendarFeed(token);
    expect(first.status).toBe(200);
    expect(first.text.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect((await calendarFeed(token, first.etag)).status).toBe(304);
  });
  it("keeps credentials out of settings and rejects other owners", async () => {
    expect(JSON.stringify(await loadCalendarSettings(owner))).not.toContain(token);
    await expect(calendarFeedLink("other-user", targetId)).rejects.toMatchObject({ status: 404 });
    await expect(calendarFeed("invalid")).rejects.toMatchObject({ status: 404 });
  });
  it("rotates capabilities without changing event identity", async () => {
    const before = await calendarFeed(token);
    await configureCalendarTarget(owner, { allianceId, provider: "apple", enabled: true, sources: ["regular"], version: 1, rotate: true });
    await expect(calendarFeed(token, before.etag)).rejects.toMatchObject({ status: 404 });
    token = new URL(await calendarFeedLink(owner, targetId)).searchParams.get("token")!;
    expect((await calendarFeed(token)).etag).toBe(before.etag);
  });
  it("checks current membership before honoring an existing ETag", async () => {
    const before = await calendarFeed(token);
    await getDb().update(schema.allianceMemberships).set({ status: "removed" }).where(and(eq(schema.allianceMemberships.hqUserId, owner), eq(schema.allianceMemberships.allianceId, allianceId)));
    await expect(calendarFeed(token, before.etag)).rejects.toMatchObject({ status: 404 });
  });
  it("allows the owner to revoke after leaving, without restoring access", async () => {
    await configureCalendarTarget(owner, { allianceId, provider: "apple", enabled: false, sources: [], version: 2 });
    await expect(calendarFeedLink(owner, targetId)).rejects.toMatchObject({ status: 404 });
    await expect(calendarFeed(token)).rejects.toMatchObject({ status: 404 });
  });
});
