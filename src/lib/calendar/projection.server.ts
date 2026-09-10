import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { calendarPrincipal, type CalendarTx } from "./access.server";
import { calendarEvents } from "./sources.server";
import { calendarHash, lockCalendarTarget, readCalendarPreferences } from "./repository.server";
import { CalendarError } from "./types.shared";

export type CalendarTarget = typeof schema.calendarTargets.$inferSelect;
export type CalendarEntry = typeof schema.calendarEntries.$inferSelect;

export async function projectCalendar(tx: CalendarTx, target: CalendarTarget, now = new Date()) {
  const principal = await calendarPrincipal(tx, target.hqUserId, target.allianceId);
  const preferences = await readCalendarPreferences(tx, target.hqUserId);
  const events = target.enabled && principal ? await calendarEvents(tx, principal, preferences, target.sources, now) : [];
  const existing = await tx.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.targetId, target.id));
  const keys = new Set(events.map((row) => row.key));
  for (const event of events) {
    const old = existing.find((row) => row.key === event.key), fingerprint = calendarHash(JSON.stringify(event));
    if (old && old.fingerprint === fingerprint && !old.cancelled) continue;
    await tx.insert(schema.calendarEntries).values({ targetId: target.id, key: event.key, uid: `${calendarHash(`${target.id}:${event.key}`)}@hq.calendar`, payload: event, fingerprint })
      .onConflictDoUpdate({ target: [schema.calendarEntries.targetId, schema.calendarEntries.key], set: { payload: event, fingerprint, cancelled: false, revision: (old?.revision ?? 0) + 1, updatedAt: now } });
  }
  for (const old of existing) if (!keys.has(old.key) && !old.cancelled) await tx.update(schema.calendarEntries).set({ cancelled: true, revision: old.revision + 1, updatedAt: now }).where(and(eq(schema.calendarEntries.targetId, target.id), eq(schema.calendarEntries.key, old.key)));
  return { principal, preferences, entries: await tx.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.targetId, target.id)) };
}

export async function refreshCalendarProjection(targetId: string, expectedOwner?: string) {
  return getDb().transaction(async (tx) => {
    await lockCalendarTarget(tx, targetId);
    const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, targetId));
    if (!target || (expectedOwner && target.hqUserId !== expectedOwner)) throw new CalendarError("forbidden", 403);
    return { target, ...await projectCalendar(tx, target) };
  });
}
