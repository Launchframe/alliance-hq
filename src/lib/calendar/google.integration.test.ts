import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { startCalendarGoogleProvider } from "@/test/calendar-google-provider";
import { startGoogleCalendar, finishGoogleCalendar } from "./google-oauth.server";
import { configureCalendarTarget, saveCalendarPreferences } from "./repository.server";
import { disconnectGoogleCalendar, googleAccess } from "./google-account.server";
import { runCalendarTick } from "./google-worker.server";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
const owner = randomUUID(), stranger = randomUUID(), allianceId = randomUUID(), secondAllianceId = randomUUID(), loginId = randomUUID();
const envKeys = ["E2E_TEST", "CALENDAR_GOOGLE_TRANSPORT", "CALENDAR_GOOGLE_TEST_ORIGIN", "CALENDAR_APP_ORIGIN", "GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"] as const;
const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let mock: Awaited<ReturnType<typeof startCalendarGoogleProvider>>, targetId = "", ruleId = "";
const tomorrow = addCalendarDays(getServerCalendarDate(), 1);
async function connect(user = owner) {
  const flow = await startGoogleCalendar(user);
  const response = await fetch(flow.url, { redirect: "manual" });
  const callback = new URL(response.headers.get("location")!);
  return finishGoogleCalendar(user, flow.state, callback.searchParams.get("code")!);
}
async function due(id = targetId) {
  await getDb().update(schema.calendarTargets).set({ nextSyncAt: new Date(0) }).where(eq(schema.calendarTargets.id, id));
}
async function target(id = targetId) { return (await getDb().select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, id)))[0]; }
async function account() { return (await getDb().select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, owner)))[0]; }
async function addRule(eventKey: string) {
  const id = randomUUID();
  await getDb().insert(schema.regularEventScheduleRules).values({ id, allianceId, eventKey, scheduleKind: "once", oneShotDates: [tomorrow], anchorTimeSt: "20:00" });
  return id;
}

describe.skipIf(process.env.CALENDAR_DB_TEST !== "1")("Google calendar delivery against an isolated provider", () => {
  beforeAll(async () => {
    const url = process.env.E2E_DATABASE_URL ?? "";
    if (!url.includes("/alliance_hq_calendar_e2e_") || url !== process.env.DATABASE_URL || url !== process.env.LOCAL_DATABASE_URL) throw new Error("Dedicated calendar database required");
    mock = await startCalendarGoogleProvider();
    Object.assign(process.env, { E2E_TEST: "true", CALENDAR_GOOGLE_TRANSPORT: "mock", CALENDAR_GOOGLE_TEST_ORIGIN: mock.origin, CALENDAR_APP_ORIGIN: "http://localhost:5176", GOOGLE_CALENDAR_CLIENT_ID: "e2e-google-client-id", GOOGLE_CALENDAR_CLIENT_SECRET: "e2e-google-client-secret" });
    const db = getDb();
    const [server] = await db.select().from(schema.gameServers).where(eq(schema.gameServers.serverNumber, 0));
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "member"));
    await db.insert(schema.hqUsers).values([owner, stranger].map((id) => ({ id, email: `${id}@example.test` })));
    await db.insert(schema.hqAuthAccounts).values({ id: loginId, hqUserId: owner, provider: "google", providerAccountId: randomUUID(), type: "oauth" });
    await db.insert(schema.alliances).values([allianceId, secondAllianceId].map((id) => ({ id, slug: id, name: "Google calendar test", tag: "GCAL", gameServerId: server.id, gameServerNumber: 0 })));
    await db.insert(schema.allianceMemberships).values([allianceId, secondAllianceId].map((id) => ({ id: randomUUID(), hqUserId: owner, allianceId: id, roleId: role.id, source: "manual", status: "active" })));
    await saveCalendarPreferences(owner, { alerts: [10, 1], locale: "en-US", timezone: "UTC" }, 0);
    ruleId = await addRule("zombie_siege");
  });
  afterAll(async () => {
    if (mock) await mock.stop();
    for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await getDb().delete(schema.alliances).where(inArray(schema.alliances.id, [allianceId, secondAllianceId]));
    await getDb().delete(schema.hqUsers).where(inArray(schema.hqUsers.id, [owner, stranger]));
  });
  it("rejects another HQ principal and a signed but wrong nonce", async () => {
    const flow = await startGoogleCalendar(owner);
    await expect(finishGoogleCalendar(stranger, flow.state, "code")).rejects.toMatchObject({ code: "expired" });
    mock.controls.badNonce = true;
    await expect(connect()).rejects.toMatchObject({ code: "invalid_identity" });
    mock.controls.badNonce = false;
    expect(await account()).toBeUndefined();
  });
  it("stores calendar credentials separately from Google sign-in", async () => {
    const flow = await startGoogleCalendar(owner);
    const authorized = await fetch(flow.url, { redirect: "manual" });
    const code = new URL(authorized.headers.get("location")!).searchParams.get("code")!;
    await finishGoogleCalendar(owner, flow.state, code);
    await expect(finishGoogleCalendar(owner, flow.state, code)).rejects.toMatchObject({ code: "expired" });
    const row = await account();
    expect(row.email).toBe("calendar-provider@example.test");
    expect(row.hqUserId).toBe(owner);
    expect(row.refreshToken?.split(":")).toHaveLength(3);
    expect((await getDb().select().from(schema.hqAuthAccounts).where(eq(schema.hqAuthAccounts.id, loginId)))[0].hqUserId).toBe(owner);
    const users = await getDb().select().from(schema.hqUsers).where(eq(schema.hqUsers.email, row.email));
    expect(users).toHaveLength(0);
    targetId = (await configureCalendarTarget(owner, { allianceId, provider: "google", sources: ["regular"], enabled: true, version: 0 })).id;
  });
  it("leases concurrent workers and publishes exactly one mapped event", async () => {
    await Promise.all([runCalendarTick(), runCalendarTick()]);
    expect(mock.counts.calendarsCreated).toBe(1); expect(mock.counts.eventsCreated).toBe(1);
    const stored = await target();
    expect(stored.status).toBe("synced");
    const event = [...mock.calendars.get(stored.remoteCalendarId!)!.events.values()][0];
    expect(event.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "popup", minutes: 1 }] });
    expect(event).not.toHaveProperty("attendees");
  });
  it("repairs local reminder-only edits and restores locally deleted events", async () => {
    const calendar = mock.calendars.get((await target()).remoteCalendarId!)!;
    const event = [...calendar.events.values()][0];
    event.reminders = { useDefault: true }; event.etag = '"user-edit"'; event.updated = "unchanged";
    await due(); await runCalendarTick();
    expect((event.reminders as { useDefault: boolean }).useDefault).toBe(false);
    event.status = "cancelled";
    await due(); await runCalendarTick();
    expect([...calendar.events.values()].filter((row) => row.status !== "cancelled")).toHaveLength(1);
    expect(mock.counts.eventsCreated).toBe(2);
  });
  it("recovers a lost event-create response without creating a duplicate", async () => {
    await addRule("glacierdon");
    const before = mock.counts.eventsCreated;
    mock.controls.failEventAfterCreate = true;
    await due(); await runCalendarTick();
    expect(mock.counts.eventsCreated).toBe(before + 1);
    await due(); await runCalendarTick();
    expect(mock.counts.eventsCreated).toBe(before + 1);
    expect((await target()).status).toBe("synced");
  });
  it("does not report an uncertain cancellation complete until the late resource is removed", async () => {
    const id = await addRule("sky_marshall");
    mock.controls.failEventAfterCreate = true;
    await due(); await runCalendarTick();
    const [entry] = await getDb().select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, targetId), eq(schema.calendarEntries.key, `regular:${id}:${tomorrow}`)));
    const calendar = mock.calendars.get((await target()).remoteCalendarId!)!, late = calendar.events.get(entry.remoteId!)!;
    calendar.events.delete(entry.remoteId!);
    await getDb().update(schema.regularEventScheduleRules).set({ active: 0 }).where(eq(schema.regularEventScheduleRules.id, id));
    await due(); await runCalendarTick();
    const [uncertain] = await getDb().select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, targetId), eq(schema.calendarEntries.key, entry.key)));
    expect(uncertain.uncertain).toBe(true); expect(uncertain.appliedRevision).toBeLessThan(uncertain.revision);
    calendar.events.set(entry.remoteId!, late);
    await due(); await runCalendarTick();
    expect(late.status).toBe("cancelled");
  });
  it("quarantines ambiguous calendar creation instead of retrying blindly", async () => {
    const second = await configureCalendarTarget(owner, { allianceId: secondAllianceId, provider: "google", sources: [], enabled: true, version: 0 });
    const before = mock.counts.calendarsCreated;
    mock.controls.failCalendarAfterCreate = true;
    await runCalendarTick();
    expect((await target(second.id)).creationUncertain).toBe(true);
    await due(second.id); await runCalendarTick();
    expect(mock.counts.calendarsCreated).toBe(before + 1);
    await configureCalendarTarget(owner, { allianceId: secondAllianceId, provider: "google", sources: [], enabled: true, version: 1, reset: true });
    await runCalendarTick();
    expect((await target(second.id)).creationUncertain).toBe(false);
    expect(mock.counts.calendarsCreated).toBe(before + 2);
  });
  it("updates all account alerts without changing logical identity", async () => {
    const [before] = await getDb().select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, targetId), eq(schema.calendarEntries.key, `regular:${ruleId}:${tomorrow}`)));
    await saveCalendarPreferences(owner, { alerts: [5], locale: "en-US", timezone: "UTC" }, 1);
    await runCalendarTick();
    const [after] = await getDb().select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, targetId), eq(schema.calendarEntries.key, before.key)));
    expect(after.uid).toBe(before.uid);
    expect(mock.calendars.get((await target()).remoteCalendarId!)!.events.get(after.remoteId!)!.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 5 }] });
  });
  it("backs off on provider rate limits without creating more calendars", async () => {
    const before = mock.counts.calendarsCreated;
    mock.controls.rateLimit = true;
    await due(); const start = Date.now(); await runCalendarTick();
    expect((await target()).nextSyncAt.getTime()).toBeGreaterThanOrEqual(start + 60_000);
    expect(mock.counts.calendarsCreated).toBe(before);
    mock.controls.rateLimit = false; await due(); await runCalendarTick();
  });
  it("reauthorizes after a provider read before writing any updated HQ data", async () => {
    const calendar = mock.calendars.get((await target()).remoteCalendarId!)!;
    const event = [...calendar.events.values()].find((row) => row.status !== "cancelled")!;
    event.summary = "Local edit";
    const patches = mock.counts.eventPatches;
    mock.controls.beforeEventRead = async () => {
      await getDb().update(schema.allianceMemberships).set({ status: "removed" }).where(and(eq(schema.allianceMemberships.hqUserId, owner), eq(schema.allianceMemberships.allianceId, allianceId)));
    };
    await due(); await runCalendarTick();
    expect(mock.counts.eventPatches).toBe(patches);
    expect([...calendar.events.values()].filter((row) => row.status !== "cancelled")).toHaveLength(0);
    await getDb().update(schema.allianceMemberships).set({ status: "active" }).where(and(eq(schema.allianceMemberships.hqUserId, owner), eq(schema.allianceMemberships.allianceId, allianceId)));
    await due(); await runCalendarTick();
  });
  it("serializes token refresh for calendars sharing one account", async () => {
    await getDb().update(schema.calendarAccounts).set({ expiresAt: new Date(0) }).where(eq(schema.calendarAccounts.hqUserId, owner));
    const row = await account(), before = mock.counts.refreshes;
    const results = await Promise.allSettled([googleAccess(row.id, owner), googleAccess(row.id, owner)]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "busy" });
    expect(mock.counts.refreshes).toBe(before + 1);
  });
  it("handles revoked refresh consent and can reconnect without changing sign-in", async () => {
    await getDb().update(schema.calendarAccounts).set({ expiresAt: new Date(0) }).where(eq(schema.calendarAccounts.hqUserId, owner));
    mock.controls.rejectRefresh = true;
    await due(); await runCalendarTick();
    expect((await account()).status).toBe("reconnect");
    mock.controls.rejectRefresh = false;
    await connect(); await runCalendarTick();
    expect((await account()).status).toBe("connected");
  });
  it("cleans up only mapped HQ events and leaves Google sign-in linked", async () => {
    const row = await account(), calendar = mock.calendars.get((await target()).remoteCalendarId!)!;
    calendar.events.set("personal-event", { id: "personal-event", summary: "Personal event", etag: '"personal"', status: "confirmed" });
    await disconnectGoogleCalendar(owner, true, row.version);
    expect((await account()).status).toBe("disconnecting");
    await runCalendarTick();
    expect((await account()).status).toBe("revoked"); expect((await account()).refreshToken).toBeNull();
    expect([...calendar.events.values()].filter((event) => event.status !== "cancelled").map((event) => event.id)).toEqual(["personal-event"]);
    expect(await getDb().select().from(schema.hqAuthAccounts).where(eq(schema.hqAuthAccounts.id, loginId))).toHaveLength(1);
  });
  it("does not use cleanup credentials after the fixed retention deadline", async () => {
    const row = await account(), refreshes = mock.counts.refreshes;
    await getDb().update(schema.calendarAccounts).set({ status: "disconnecting", updatedAt: new Date(Date.now() - 25 * 60 * 60_000) }).where(eq(schema.calendarAccounts.id, row.id));
    await expect(googleAccess(row.id, owner, true)).rejects.toMatchObject({ code: "cleanup_expired" });
    expect(mock.counts.refreshes).toBe(refreshes);
    await runCalendarTick();
    expect((await account()).status).toBe("revoked");
  });
});
