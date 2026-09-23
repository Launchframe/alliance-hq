import "server-only";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { calendarPrincipal, type CalendarTx } from "./access.server";
import { calendarEvents } from "./sources.server";
import { calendarHash, lockCalendarTarget, readCalendarPreferences } from "./repository.server";
import { CalendarError, type CalendarEvent } from "./types.shared";

export type CalendarTarget = typeof schema.calendarTargets.$inferSelect;
export type CalendarEntry = typeof schema.calendarEntries.$inferSelect;

export async function storeCalendarEvent(tx: CalendarTx, targetId: string, previous: CalendarEntry | undefined, event: CalendarEvent | null, now = new Date()) {
  if (!event) {
    if (!previous || previous.cancelled) return previous;
    const [cancelled] = await tx.update(schema.calendarEntries).set({ cancelled: true, revision: previous.revision + 1, updatedAt: now }).where(and(eq(schema.calendarEntries.targetId, targetId), eq(schema.calendarEntries.key, previous.key))).returning();
    return cancelled;
  }
  const fingerprint = calendarHash(JSON.stringify(event));
  if (previous && previous.fingerprint === fingerprint && !previous.cancelled) return previous;
  const [saved] = await tx.insert(schema.calendarEntries).values({ targetId, key: event.key, uid: `${calendarHash(`${targetId}:${event.key}`)}@hq.calendar`, payload: event, fingerprint, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.calendarEntries.targetId, schema.calendarEntries.key], set: { payload: event, fingerprint, cancelled: false, revision: (previous?.revision ?? 0) + 1, updatedAt: now } }).returning();
  return saved;
}

export async function projectCalendar(tx: CalendarTx, target: CalendarTarget, now = new Date()) {
  const principal = await calendarPrincipal(tx, target.hqUserId, target.allianceId);
  const preferences = await readCalendarPreferences(tx, target.hqUserId);
  const events = target.enabled && principal ? await calendarEvents(tx, principal, preferences, target.sources, now) : [];
  const keys = new Set(events.map((row) => row.key));
  const relevant = or(eq(schema.calendarEntries.cancelled, false), gte(schema.calendarEntries.updatedAt, new Date(now.getTime() - 14 * 86_400_000)), target.provider === "google" ? sql`${schema.calendarEntries.appliedRevision} < ${schema.calendarEntries.revision}` : undefined);
  const existing = await tx.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, target.id), or(relevant, keys.size ? inArray(schema.calendarEntries.key, [...keys]) : undefined)));
  const byKey = new Map(existing.map((row) => [row.key, row]));
  for (const event of events) await storeCalendarEvent(tx, target.id, byKey.get(event.key), event, now);
  for (const old of existing) if (!keys.has(old.key) && !old.cancelled) await storeCalendarEvent(tx, target.id, old, null, now);
  return { principal, preferences, entries: await tx.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.targetId, target.id), relevant)) };
}

export async function refreshCalendarProjection(targetId: string, expectedOwner?: string) {
  return getDb().transaction(async (tx) => {
    await lockCalendarTarget(tx, targetId);
    const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, targetId));
    if (!target || (expectedOwner && target.hqUserId !== expectedOwner)) throw new CalendarError("forbidden", 403);
    return { target, ...await projectCalendar(tx, target) };
  });
}
