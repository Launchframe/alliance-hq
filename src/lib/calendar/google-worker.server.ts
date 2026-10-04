import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb, schema } from "@/lib/db";
import { calendarPrincipal, type CalendarTx } from "./access.server";
import { calendarHash, lockCalendarTarget, readCalendarPreferences } from "./repository.server";
import { projectCalendar, storeCalendarEvent, type CalendarEntry, type CalendarTarget } from "./projection.server";
import { calendarEvents } from "./sources.server";
import { CalendarError } from "./types.shared";
import { googleAccess, googleRequest, finalizeGoogleDisconnects, type GoogleAccess } from "./google-account.server";
import { GoogleCalendarError } from "./google-transport.server";
import { googleEventBody, googleEventMatches, type GoogleEvent } from "./google-fields.shared";
import { calendarAppOrigin } from "./origin.server";

async function lease<T>(snapshot: CalendarTarget, action: (tx: CalendarTx, target: CalendarTarget) => Promise<T>) {
  return getDb().transaction(async (tx) => {
    await lockCalendarTarget(tx, snapshot.id);
    const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, snapshot.id)).for("update");
    if (!target || target.leaseToken !== snapshot.leaseToken || target.generation !== snapshot.generation || !target.leaseUntil || target.leaseUntil <= new Date() || target.accountId !== snapshot.accountId || target.enabled !== snapshot.enabled || target.cleanup !== snapshot.cleanup) throw new CalendarError("stale", 409);
    return action(tx, target);
  });
}
async function checkAccount(tx: CalendarTx, target: CalendarTarget, access: GoogleAccess) {
  const [account] = await tx.select().from(schema.calendarAccounts).where(and(eq(schema.calendarAccounts.id, access.accountId), eq(schema.calendarAccounts.hqUserId, target.hqUserId)));
  if (!account || account.version !== access.accountVersion || account.subject !== access.subject || !(account.status === "connected" || target.cleanup && account.status === "disconnecting")) throw new CalendarError("stale", 409);
}

async function claimTarget() {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [target] = await tx.select().from(schema.calendarTargets).where(and(eq(schema.calendarTargets.provider, "google"), eq(schema.calendarTargets.creationUncertain, false), or(eq(schema.calendarTargets.enabled, true), eq(schema.calendarTargets.cleanup, true)), lte(schema.calendarTargets.nextSyncAt, now), or(isNull(schema.calendarTargets.leaseUntil), lt(schema.calendarTargets.leaseUntil, now)))).orderBy(asc(schema.calendarTargets.nextSyncAt), asc(schema.calendarTargets.id)).limit(1).for("update", { skipLocked: true });
    if (!target) return null;
    const [claimed] = await tx.update(schema.calendarTargets).set({ leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 75_000) }).where(eq(schema.calendarTargets.id, target.id)).returning();
    return claimed;
  });
}

async function prepareEntry(snapshot: CalendarTarget, key: string, access: GoogleAccess) {
  return lease(snapshot, async (tx, target) => {
    await checkAccount(tx, target, access);
    const [entry] = await tx.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, target.id), eq(schema.calendarEntries.key, key))).for("update");
    if (!entry) throw new CalendarError("stale", 409);
    const principal = await calendarPrincipal(tx, target.hqUserId, target.allianceId), preferences = await readCalendarPreferences(tx, target.hqUserId);
    const window = entry.payload.source === "plunder" ? { from: new Date(Date.parse(entry.payload.start) - 3 * 86_400_000), until: new Date(Date.parse(entry.payload.end) + 3 * 86_400_000) } : undefined;
    const now = new Date(), inRange = Date.parse(entry.payload.end) > now.getTime() - 86_400_000 && Date.parse(entry.payload.start) < now.getTime() + 90 * 86_400_000;
    const events = target.enabled && principal && inRange && target.sources.includes(entry.payload.source) ? await calendarEvents(tx, principal, preferences, [entry.payload.source], now, window) : [];
    const current = await storeCalendarEvent(tx, target.id, entry, events.find((event) => event.key === key) ?? null);
    if (!current) throw new CalendarError("stale", 409);
    return { target, entry: current, preferences };
  });
}

async function entryChange(snapshot: CalendarTarget, expected: CalendarEntry, access: GoogleAccess, values: Partial<typeof schema.calendarEntries.$inferInsert>) {
  return lease(snapshot, async (tx, target) => {
    await checkAccount(tx, target, access);
    const [row] = await tx.update(schema.calendarEntries).set(values).where(and(eq(schema.calendarEntries.targetId, target.id), eq(schema.calendarEntries.key, expected.key), eq(schema.calendarEntries.revision, expected.revision), expected.remoteId ? eq(schema.calendarEntries.remoteId, expected.remoteId) : isNull(schema.calendarEntries.remoteId))).returning();
    if (!row) throw new CalendarError("stale", 409);
    return row;
  });
}

async function syncEntry(snapshot: CalendarTarget, key: string, access: GoogleAccess) {
  let prepared = await prepareEntry(snapshot, key, access), entry = prepared.entry;
  if (entry.cancelled && !entry.remoteId) {
    await entryChange(snapshot, entry, access, { appliedRevision: entry.revision, uncertain: false });
    return;
  }
  if (!entry.remoteId) entry = await entryChange(snapshot, entry, access, { remoteId: calendarHash(`${entry.uid}:${entry.remoteGeneration}`), remoteConfirmed: false });
  const path = `/calendars/${encodeURIComponent(snapshot.remoteCalendarId!)}/events/${encodeURIComponent(entry.remoteId!)}`;
  let remote: GoogleEvent | null = null, gone = false;
  try { remote = await googleRequest<GoogleEvent>(access, "GET", path); }
  catch (error) { if (!(error instanceof GoogleCalendarError) || ![404, 410].includes(error.providerStatus)) throw error; gone = error.providerStatus === 410; }
  if (remote?.status === "cancelled") { remote = null; gone = true; }
  if (remote) {
    if (remote.id !== entry.remoteId || remote.extendedProperties?.private?.hqTarget !== snapshot.id || remote.extendedProperties?.private?.hqUid !== entry.uid) throw new CalendarError("remote_conflict", 409);
    entry = await entryChange(snapshot, entry, access, { remoteConfirmed: true, uncertain: false });
  }
  prepared = await prepareEntry(snapshot, entry.key, access); entry = prepared.entry;
  if (entry.cancelled) {
    if (!remote && entry.uncertain) throw new CalendarError("uncertain_event", 409);
    if (remote) {
      try { await googleRequest<void>(access, "DELETE", `${path}?sendUpdates=none`, undefined, remote.etag); }
      catch (error) { if (!(error instanceof GoogleCalendarError) || ![404, 410].includes(error.providerStatus)) throw error; }
    }
    await entryChange(snapshot, entry, access, { appliedRevision: entry.revision, uncertain: false });
    return;
  }
  const t = await getTranslations({ locale: prepared.preferences.locale, namespace: "calendarConnections" });
  const desired = googleEventBody(entry, { origin: calendarAppOrigin(), locale: prepared.preferences.locale, name: t("calendarName") });
  if (remote) {
    if (!googleEventMatches(remote, desired)) {
      const saved = await googleRequest<GoogleEvent>(access, "PATCH", `${path}?sendUpdates=none`, { ...desired, extendedProperties: { private: { ...remote.extendedProperties?.private, ...desired.extendedProperties.private } } }, remote.etag);
      if (!googleEventMatches(saved, desired)) throw new GoogleCalendarError("invalid_provider_response", 502);
    }
    await entryChange(snapshot, entry, access, { appliedRevision: entry.revision, remoteConfirmed: true, uncertain: false });
    return;
  }
  if (gone || entry.remoteConfirmed) entry = await entryChange(snapshot, entry, access, { remoteGeneration: entry.remoteGeneration + 1, remoteId: calendarHash(`${entry.uid}:${entry.remoteGeneration + 1}`), remoteConfirmed: false, uncertain: false });
  entry = await entryChange(snapshot, entry, access, { uncertain: true });
  const created = await googleRequest<GoogleEvent>(access, "POST", `/calendars/${encodeURIComponent(snapshot.remoteCalendarId!)}/events?sendUpdates=none`, { ...desired, id: entry.remoteId, visibility: "private", transparency: "transparent" });
  if (created.id !== entry.remoteId || !googleEventMatches(created, desired)) throw new GoogleCalendarError("invalid_provider_response", 502);
  await entryChange(snapshot, entry, access, { appliedRevision: entry.revision, remoteConfirmed: true, uncertain: false });
}

async function ensureRemoteCalendar(snapshot: CalendarTarget, access: GoogleAccess, name: string, timezone: string) {
  if (snapshot.remoteCalendarId) return snapshot;
  await lease(snapshot, async (tx, target) => {
    await checkAccount(tx, target, access);
    if (!target.enabled || target.cleanup) throw new CalendarError("stale", 409);
    await tx.update(schema.calendarTargets).set({ status: "creating", creationUncertain: true }).where(eq(schema.calendarTargets.id, target.id));
  });
  try {
    const created = await googleRequest<{ id: string }>(access, "POST", "/calendars", { summary: name, timeZone: timezone });
    if (typeof created.id !== "string" || !created.id || created.id.length > 1024) throw new GoogleCalendarError("invalid_provider_response", 502);
    await getDb().transaction(async (tx) => {
      await lockCalendarTarget(tx, snapshot.id);
      const [current] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, snapshot.id)).for("update");
      if (!current || current.leaseToken !== snapshot.leaseToken || current.accountId !== snapshot.accountId || current.remoteCalendarId) throw new CalendarError("stale", 409);
      await tx.update(schema.calendarTargets).set({ remoteCalendarId: created.id, creationUncertain: false, status: current.generation === snapshot.generation ? "pending" : current.status }).where(eq(schema.calendarTargets.id, current.id));
    });
    return { ...snapshot, remoteCalendarId: created.id };
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.providerStatus >= 400 && error.providerStatus < 500 && snapshot.leaseToken) await getDb().update(schema.calendarTargets).set({ creationUncertain: false }).where(and(eq(schema.calendarTargets.id, snapshot.id), eq(schema.calendarTargets.leaseToken, snapshot.leaseToken)));
    throw error;
  }
}

async function runTarget(snapshot: CalendarTarget, deadline: number) {
  let target = snapshot;
  const projection = await lease(target, (tx, current) => projectCalendar(tx, current));
  if (!target.accountId) throw new CalendarError("reconnect", 409);
  const access = await googleAccess(target.accountId, target.hqUserId, target.cleanup);
  if (!target.remoteCalendarId && (!target.enabled || !projection.principal)) {
    await lease(target, async (tx) => { await tx.update(schema.calendarEntries).set({ appliedRevision: sql`${schema.calendarEntries.revision}` }).where(eq(schema.calendarEntries.targetId, target.id)); });
    return { cursor: 0, error: null };
  }
  if (!target.remoteCalendarId) {
    const t = await getTranslations({ locale: projection.preferences.locale, namespace: "calendarConnections" });
    target = await ensureRemoteCalendar(target, access, `${t("calendarName")}${projection.principal?.tag ? ` — ${projection.principal.tag}` : ""}`, projection.preferences.timezone);
  }
  await lease(target, (tx, current) => checkAccount(tx, current, access));
  let calendar: { id: string; timeZone?: string; etag?: string };
  try { calendar = await googleRequest(access, "GET", `/calendars/${encodeURIComponent(target.remoteCalendarId!)}`); }
  catch (error) {
    if (error instanceof GoogleCalendarError && [404, 410].includes(error.providerStatus)) {
      if (target.cleanup) {
        await lease(target, async (tx) => { await tx.update(schema.calendarEntries).set({ appliedRevision: sql`${schema.calendarEntries.revision}`, uncertain: false }).where(eq(schema.calendarEntries.targetId, target.id)); });
        return { cursor: 0, error: null };
      }
      throw new CalendarError("calendar_missing", 409);
    }
    throw error;
  }
  if (calendar.id !== target.remoteCalendarId) throw new GoogleCalendarError("invalid_provider_response", 502);
  if (target.enabled && calendar.timeZone !== projection.preferences.timezone) {
    await lease(target, (tx, current) => checkAccount(tx, current, access));
    await googleRequest(access, "PATCH", `/calendars/${encodeURIComponent(target.remoteCalendarId!)}`, { timeZone: projection.preferences.timezone }, calendar.etag);
  }
  const entries = projection.entries.filter((row) => !row.cancelled || row.remoteId || row.appliedRevision < row.revision || row.uncertain).sort((a, b) => a.key.localeCompare(b.key));
  const cursor = entries.length ? target.scanCursor % entries.length : 0;
  const rotated = [...entries.slice(cursor), ...entries.slice(0, cursor)];
  const dirty = rotated.filter((row) => row.revision !== row.appliedRevision || row.uncertain);
  const selected = (dirty.length ? dirty : rotated).slice(0, 20);
  let nextCursor = cursor, error: unknown = null;
  for (const entry of selected) {
    if (Date.now() + 9000 >= deadline) break;
    try { await syncEntry(target, entry.key, access); }
    catch (cause) {
      if (cause instanceof CalendarError && cause.code === "stale") throw cause;
      error = cause;
      if (cause instanceof GoogleCalendarError && [0, 401, 403, 429].includes(cause.providerStatus)) break;
    }
    nextCursor = entries.length ? (entries.findIndex((row) => row.key === entry.key) + 1) % entries.length : 0;
  }
  return { cursor: nextCursor, error };
}

async function releaseTarget(snapshot: CalendarTarget, cursor: number, error: unknown) {
  await getDb().transaction(async (tx) => {
    await lockCalendarTarget(tx, snapshot.id);
    const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, snapshot.id)).for("update");
    if (!target || target.leaseToken !== snapshot.leaseToken) return;
    if (target.generation !== snapshot.generation) {
      await tx.update(schema.calendarTargets).set({ leaseToken: null, leaseUntil: null }).where(eq(schema.calendarTargets.id, target.id)); return;
    }
    const [pending] = await tx.select({ key: schema.calendarEntries.key }).from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, target.id), or(sql`${schema.calendarEntries.appliedRevision} < ${schema.calendarEntries.revision}`, eq(schema.calendarEntries.uncertain, true)))).limit(1);
    const failed = !!error, count = failed ? target.failureCount + 1 : 0;
    const reconnect = error instanceof CalendarError && error.code === "reconnect";
    const status = target.creationUncertain ? "uncertain" : failed ? reconnect ? "reconnect" : error instanceof CalendarError && error.code === "calendar_missing" ? "calendar_missing" : "failed" : pending ? target.cleanup ? "cleanup" : "pending" : target.enabled ? "synced" : "disabled";
    const delay = failed ? Math.max(Math.min(3600, 30 * 2 ** Math.min(count, 7)), error instanceof GoogleCalendarError ? error.retryAfter : 0) : 60;
    await tx.update(schema.calendarTargets).set({ leaseToken: null, leaseUntil: null, status, scanCursor: cursor, failureCount: count, nextSyncAt: new Date(Date.now() + delay * 1000), ...(!failed && !pending ? { lastSyncAt: new Date(), cleanup: false } : {}) }).where(eq(schema.calendarTargets.id, target.id));
  });
}

export async function runCalendarTick() {
  const deadline = Date.now() + 45_000;
  await finalizeGoogleDisconnects();
  await getDb().update(schema.calendarTargets).set({ status: "uncertain" }).where(and(eq(schema.calendarTargets.provider, "google"), eq(schema.calendarTargets.enabled, true), eq(schema.calendarTargets.creationUncertain, true), or(isNull(schema.calendarTargets.leaseUntil), lt(schema.calendarTargets.leaseUntil, new Date()))));
  let processed = 0, failed = 0;
  for (let i = 0; i < 5 && Date.now() + 10_000 < deadline; i++) {
    const target = await claimTarget(); if (!target) break;
    let cursor = target.scanCursor, error: unknown = null;
    try { const result = await runTarget(target, deadline); cursor = result.cursor; error = result.error; }
    catch (cause) { error = cause; }
    await releaseTarget(target, cursor, error);
    processed++; if (error) failed++;
  }
  await finalizeGoogleDisconnects();
  await getDb().delete(schema.calendarOauthStates).where(lt(schema.calendarOauthStates.expiresAt, new Date()));
  await getDb().delete(schema.trainBoardingPrompts).where(lt(schema.trainBoardingPrompts.expiresAt, new Date()));
  return { processed, failed };
}
