import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto/encrypt";
import { calendarHash } from "@/lib/calendar/repository.server";
import { CalendarError } from "@/lib/calendar/types.shared";
import { lockAllianceAvailability, type AvailabilityTransaction } from "@/lib/time-off/availability.server";
import { lockConductorRecord } from "./repository";
import { getServerCalendarDate } from "./game-time";
import { boardingWindow, parseBoardingCountdown } from "./boarding.shared";

export async function beginBoarding(tx: AvailabilityTransaction, record: typeof schema.trainConductorRecords.$inferSelect) {
  if (!record.lockedAt || record.date !== getServerCalendarDate()) return;
  await tx.insert(schema.trainBoardingWindows).values({ recordId: record.id, allianceId: record.allianceId, lockAt: record.lockedAt }).onConflictDoUpdate({ target: schema.trainBoardingWindows.recordId, set: {
    lockAt: record.lockedAt, status: "pending", startsAt: null, endsAt: null, basis: null, observedAt: null, remainingSeconds: null, requestId: null, requestHash: null, actorId: null,
    version: sql`${schema.trainBoardingWindows.version} + 1`, updatedAt: new Date(),
  }, setWhere: sql`${schema.trainBoardingWindows.lockAt} <> ${record.lockedAt.toISOString()}::timestamptz` });
}

export async function lockConductorWithBoarding(recordId: string, allianceId: string, actorId?: string | null) {
  return (await lockConductorsWithBoarding([recordId], allianceId, actorId))[0];
}

export async function lockConductorsWithBoarding(recordIds: string[], allianceId: string, actorId?: string | null) {
  return getDb().transaction(async (tx) => {
    const records = [];
    for (const id of [...new Set(recordIds)].sort()) {
      const record = await lockConductorRecord(id, allianceId, actorId, tx);
      await beginBoarding(tx, record);
      records.push(record);
    }
    return records;
  });
}

export async function readBoarding(allianceId: string, recordId: string, actorId: string) {
  const [row] = await getDb().select({ window: schema.trainBoardingWindows, lockedAt: schema.trainConductorRecords.lockedAt }).from(schema.trainBoardingWindows)
    .innerJoin(schema.trainConductorRecords, and(eq(schema.trainConductorRecords.id, schema.trainBoardingWindows.recordId), eq(schema.trainConductorRecords.allianceId, schema.trainBoardingWindows.allianceId)))
    .where(and(eq(schema.trainBoardingWindows.recordId, recordId), eq(schema.trainBoardingWindows.allianceId, allianceId)));
  if (!row?.lockedAt || row.window.lockAt.getTime() !== row.lockedAt.getTime()) return null;
  const issuedAt = Date.now();
  return { ...row.window, clockToken: encryptSecret(JSON.stringify({ recordId, allianceId, actorId, lockAt: row.lockedAt.toISOString(), issuedAt })), serverNow: new Date(issuedAt).toISOString() };
}

export async function submitBoarding(allianceId: string, actorId: string, input: { recordId: string; version: number; requestId: string; clockToken: string; elapsedMs: number; countdown: string | null }) {
  if (!/^[\w-]{12,100}$/.test(input.requestId) || !Number.isInteger(input.version)) throw new CalendarError("invalid_countdown");
  let clock: { recordId: string; allianceId: string; actorId: string; lockAt: string; issuedAt: number };
  try { clock = JSON.parse(decryptSecret(input.clockToken)); } catch { throw new CalendarError("expired", 409); }
  if (clock.recordId !== input.recordId || clock.allianceId !== allianceId || clock.actorId !== actorId) throw new CalendarError("forbidden", 403);
  const hash = calendarHash(JSON.stringify([input.clockToken, input.countdown, input.elapsedMs, input.version]));
  return getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, allianceId);
    const [record] = await tx.select().from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.id, input.recordId), eq(schema.trainConductorRecords.allianceId, allianceId))).for("update");
    if (!record?.lockedAt || record.lockedAt.toISOString() !== clock.lockAt) throw new CalendarError("stale", 409);
    const [window] = await tx.select().from(schema.trainBoardingWindows).where(and(eq(schema.trainBoardingWindows.recordId, record.id), eq(schema.trainBoardingWindows.allianceId, allianceId))).for("update");
    if (!window || window.lockAt.toISOString() !== clock.lockAt) throw new CalendarError("stale", 409);
    if (window.requestId === input.requestId) {
      if (window.requestHash !== hash) throw new CalendarError("stale", 409);
      return window;
    }
    if (window.version !== input.version) throw new CalendarError("stale", 409);
    const now = Date.now();
    if (!Number.isFinite(clock.issuedAt) || now - clock.issuedAt > 15 * 60_000 || clock.issuedAt > now || !Number.isFinite(input.elapsedMs) || input.elapsedMs < 0 || clock.issuedAt + input.elapsedMs > now + 2000) throw new CalendarError("expired", 409);
    let remaining: number | null;
    try { remaining = input.countdown === null ? null : parseBoardingCountdown(input.countdown); } catch { throw new CalendarError("invalid_countdown"); }
    const observedAt = new Date(Math.min(now, clock.issuedAt + input.elapsedMs));
    const result = boardingWindow({ lockedAt: clock.lockAt, observedAt: observedAt.toISOString(), remainingSeconds: remaining });
    const [saved] = await tx.update(schema.trainBoardingWindows).set({ startsAt: new Date(result.startsAt), endsAt: new Date(result.endsAt), basis: result.basis, observedAt, remainingSeconds: remaining, status: Date.parse(result.endsAt) > now ? "active" : "closed", version: window.version + 1, requestId: input.requestId, requestHash: hash, actorId, updatedAt: new Date(now) }).where(eq(schema.trainBoardingWindows.recordId, record.id)).returning();
    await tx.update(schema.calendarTargets).set({ nextSyncAt: new Date(now) }).where(eq(schema.calendarTargets.allianceId, allianceId));
    return saved;
  });
}
