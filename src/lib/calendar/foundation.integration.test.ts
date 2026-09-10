import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { beginBoarding, readBoarding, submitBoarding } from "@/lib/trains/boarding.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { calendarPrincipal } from "./access.server";
import { calendarEvents } from "./sources.server";
import { configureCalendarTarget, readCalendarPreferences, saveCalendarPreferences } from "./repository.server";
import { refreshCalendarProjection } from "./projection.server";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
const enabled = process.env.CALENDAR_DB_TEST === "1";
const id = () => `calendar-${randomUUID()}`;
const allianceId = id(), otherAllianceId = id(), user = id(), other = id(), outsider = id(), recordId = id();
const lockedAt = new Date(Date.now() - 10 * 60_000);
const gameServerId = id(), seasonId = id();
let targetId = "";

describe.skipIf(!enabled)("calendar foundation with isolated Postgres", () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (url !== process.env.LOCAL_DATABASE_URL || url !== process.env.E2E_DATABASE_URL || !/^\/alliance_hq_calendar_e2e_/.test(new URL(url).pathname) || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Dedicated calendar test database required");
    const db = getDb();
    await db.insert(schema.hqUsers).values([user, other, outsider].map((id) => ({ id, email: `${id}@example.test` })));
    await db.insert(schema.gameSeasons).values({ id: seasonId, seasonNumber: 1000000 + Math.floor(Math.random() * 1000000) });
    await db.insert(schema.gameServers).values({ id: gameServerId, serverNumber: 1000000 + Math.floor(Math.random() * 1000000), seasonId });
    await db.insert(schema.alliances).values([{ id: allianceId, slug: allianceId, tag: "CALTEST", name: "Calendar test", operatingMode: "native", gameServerNumber: 1, gameServerId }, { id: otherAllianceId, slug: otherAllianceId, tag: "OTHER", name: "Other test", operatingMode: "native", gameServerNumber: 1, gameServerId }]);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "member")).limit(1);
    await db.insert(schema.allianceMemberships).values([user, other].map((hqUserId) => ({ id: id(), hqUserId, allianceId, roleId: role.id, source: "manual", status: "active" })));
    await db.insert(schema.trainConductorRecords).values({ id: recordId, allianceId, date: getServerCalendarDate(), conductorMemberId: "test-member", conductorMemberName: "Commander", lockedAt });
    await db.transaction(async (tx) => { const [record] = await tx.select().from(schema.trainConductorRecords).where(eq(schema.trainConductorRecords.id, recordId)); await beginBoarding(tx, record); });
  });
  afterAll(async () => {
    await getDb().delete(schema.alliances).where(inArray(schema.alliances.id, [allianceId, otherAllianceId]));
    await getDb().delete(schema.hqUsers).where(inArray(schema.hqUsers.id, [user, other, outsider]));
    await getDb().delete(schema.gameServers).where(eq(schema.gameServers.id, gameServerId));
    await getDb().delete(schema.gameSeasons).where(eq(schema.gameSeasons.id, seasonId));
  });
  it("keeps a timing intent pending rather than exporting an unconfirmed estimate", async () => {
    const principal = (await calendarPrincipal(getDb(), user, allianceId))!;
    const events = await getDb().transaction((tx) => calendarEvents(tx, principal, { alerts: [10, 1], locale: "en-US", timezone: "UTC" }, ["boarding"]));
    expect(events).toEqual([]);
  });
  it("atomically publishes a countdown and returns the same result on replay", async () => {
    const window = (await readBoarding(allianceId, recordId, `hq:${user}`))!;
    const input = { recordId, version: window.version, requestId: id(), clockToken: window.clockToken, elapsedMs: 0, countdown: "01:20:00" };
    const results = await Promise.all([submitBoarding(allianceId, `hq:${user}`, input), submitBoarding(allianceId, `hq:${user}`, input)]);
    expect(results[0].endsAt).toEqual(results[1].endsAt);
    expect(results[0].endsAt!.getTime() - results[0].startsAt!.getTime()).toBe(235 * 60_000);
    expect(results[0].endsAt!.getTime()).toBe(Date.parse(window.serverNow) + 75 * 60_000);
  });
  it("publishes the same train to all active accounts without Commander ownership", async () => {
    for (const hqUserId of [user, other]) {
      const principal = (await calendarPrincipal(getDb(), hqUserId, allianceId))!;
      expect(principal.memberIds).toEqual([]);
      const events = await getDb().transaction((tx) => calendarEvents(tx, principal, { alerts: [10, 1], locale: "en-US", timezone: "UTC" }, ["boarding"]));
      expect(events).toHaveLength(1);
      expect(events[0].alerts).toEqual([10, 1]);
      expect(events[0].title).toBe("boarding.title");
      expect(JSON.stringify(events)).not.toContain("test-member");
    }
    expect(await calendarPrincipal(getDb(), outsider, allianceId)).toBeNull();
  });
  it("rejects another actor's timing capability", async () => {
    const window = (await readBoarding(allianceId, recordId, `hq:${user}`))!;
    await expect(submitBoarding(allianceId, `hq:${other}`, { recordId, version: window.version, requestId: id(), clockToken: window.clockToken, elapsedMs: 0, countdown: null })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("serializes account preference updates", async () => {
    const result = await Promise.allSettled([saveCalendarPreferences(user, { alerts: [10, 1], locale: "en-US", timezone: "UTC" }, 0), saveCalendarPreferences(user, { alerts: [], locale: "en-US", timezone: "UTC" }, 0)]);
    expect(result.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect((await readCalendarPreferences(getDb(), user)).version).toBe(1);
  });
  it("keeps feed identity stable while alerts change and denies cross-alliance creation", async () => {
    const target = await configureCalendarTarget(user, { allianceId, provider: "apple", sources: ["boarding"], enabled: true, version: 0 });
    targetId = target.id;
    const first = await refreshCalendarProjection(targetId, user);
    await saveCalendarPreferences(user, { alerts: [15, 5], locale: "en-US", timezone: "UTC" }, 1);
    const second = await refreshCalendarProjection(targetId, user);
    expect(first.entries[0].uid).toBe(second.entries[0].uid);
    expect(second.entries[0].revision).toBe(first.entries[0].revision + 1);
    await expect(configureCalendarTarget(user, { allianceId: otherAllianceId, provider: "apple", sources: ["boarding"], enabled: true, version: 0 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(refreshCalendarProjection(targetId, other)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("withdraws boarding after unlock and fences old timing submissions", async () => {
    const window = (await readBoarding(allianceId, recordId, `hq:${user}`))!;
    await getDb().update(schema.trainConductorRecords).set({ lockedAt: null }).where(eq(schema.trainConductorRecords.id, recordId));
    expect((await refreshCalendarProjection(targetId, user)).entries[0].cancelled).toBe(true);
    await expect(submitBoarding(allianceId, `hq:${user}`, { recordId, version: window.version, requestId: id(), clockToken: window.clockToken, elapsedMs: 0, countdown: "04:00:00" })).rejects.toMatchObject({ code: "stale" });
  });
  it("removes export authority when membership is revoked", async () => {
    await getDb().update(schema.allianceMemberships).set({ status: "removed" }).where(and(eq(schema.allianceMemberships.hqUserId, user), eq(schema.allianceMemberships.allianceId, allianceId)));
    expect(await calendarPrincipal(getDb(), user, allianceId)).toBeNull();
  });
});
