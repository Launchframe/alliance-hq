import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { calendarPrincipal, type CalendarTx } from "./access.server";
import { parseCalendarPreferences, parseCalendarSources } from "./preferences.shared";
import { CalendarError, type CalendarPreferences } from "./types.shared";

export const calendarHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const lockCalendarTarget = (tx: CalendarTx, id: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar-target:${id}`}, 0))`);
export const lockCalendarUser = (tx: CalendarTx, id: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar-user:${id}`}, 0))`);

export async function readCalendarPreferences(tx: Pick<CalendarTx, "select">, hqUserId: string): Promise<CalendarPreferences & { version: number }> {
  const [row] = await tx.select().from(schema.calendarPreferences).where(eq(schema.calendarPreferences.hqUserId, hqUserId));
  return row ? { ...parseCalendarPreferences(row), version: row.version } : { alerts: [], locale: "en-US", timezone: "UTC", version: 0 };
}

export async function dirtyCalendarTargets(tx: CalendarTx, condition: SQL, invalidate = false) {
  const targets = await tx.select({ id: schema.calendarTargets.id }).from(schema.calendarTargets).where(condition).orderBy(asc(schema.calendarTargets.id));
  for (const { id } of targets) {
    await lockCalendarTarget(tx, id);
    const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, id));
    if (!target) continue;
    await tx.update(schema.calendarTargets).set({ generation: target.generation + 1, scanCursor: 0, nextSyncAt: new Date(), status: target.provider === "google" && target.enabled ? "pending" : target.status }).where(eq(schema.calendarTargets.id, id));
    if (invalidate && target.provider === "google") await tx.update(schema.calendarEntries).set({ appliedRevision: 0 }).where(and(eq(schema.calendarEntries.targetId, id), eq(schema.calendarEntries.cancelled, false)));
  }
}
export const dirtyCalendarUser = (tx: CalendarTx, user: string, invalidate = false) => dirtyCalendarTargets(tx, eq(schema.calendarTargets.hqUserId, user), invalidate);

export async function saveCalendarPreferences(hqUserId: string, input: unknown, version: number) {
  const preferences = parseCalendarPreferences(input);
  return getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    const previous = await readCalendarPreferences(tx, hqUserId);
    if (previous.version !== version) throw new CalendarError("stale", 409);
    await tx.insert(schema.calendarPreferences).values({ hqUserId, ...preferences, version: version + 1 }).onConflictDoUpdate({ target: schema.calendarPreferences.hqUserId, set: { ...preferences, version: version + 1 } });
    await dirtyCalendarUser(tx, hqUserId, true);
    return { ...preferences, version: version + 1 };
  });
}

export async function configureCalendarTarget(hqUserId: string, input: { allianceId: string; provider: string; sources: unknown; enabled: boolean; version: number; rotate?: boolean; cleanup?: boolean; reset?: boolean }) {
  if (!["apple", "google"].includes(input.provider) || typeof input.enabled !== "boolean" || !Number.isSafeInteger(input.version) || input.version < 0) throw new CalendarError("invalid_target");
  const sources = parseCalendarSources(input.sources);
  return getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    if (input.enabled && !await calendarPrincipal(tx, hqUserId, input.allianceId)) throw new CalendarError("forbidden", 403);
    const [found] = await tx.select({ id: schema.calendarTargets.id }).from(schema.calendarTargets).where(and(eq(schema.calendarTargets.hqUserId, hqUserId), eq(schema.calendarTargets.allianceId, input.allianceId), eq(schema.calendarTargets.provider, input.provider)));
    const id = found?.id ?? nanoid();
    await lockCalendarTarget(tx, id);
    const [existing] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, id));
    if ((existing?.version ?? 0) !== input.version) throw new CalendarError("stale", 409);
    if (!existing && !input.enabled) throw new CalendarError("invalid_target");
    const [account] = await tx.select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, hqUserId));
    if (input.enabled && input.provider === "google" && account?.status !== "connected") throw new CalendarError("reconnect", 409);
    const reset = input.provider === "google" && input.enabled && (input.reset === true || !!existing && existing.accountId !== account?.id);
    if (input.enabled && existing && (existing.status === "creating" || existing.creationUncertain) && existing.leaseUntil && existing.leaseUntil > new Date()) throw new CalendarError("busy", 409);
    if (input.enabled && (existing?.creationUncertain || existing?.status === "creating") && !reset) throw new CalendarError("uncertain", 409);
    const feedToken = input.provider === "apple" && input.enabled && (!existing?.feedHash || input.rotate) ? randomBytes(32).toString("base64url") : null;
    const cleanup = input.provider === "google" && !input.enabled && input.cleanup === true;
    const values = { sources, enabled: input.enabled, version: input.version + 1, generation: (existing?.generation ?? 0) + 1, scanCursor: 0, nextSyncAt: new Date(), cleanup,
      status: input.enabled ? "pending" : cleanup ? "cleanup" : "disabled", accountId: input.provider === "google" ? account?.id ?? null : null,
      ...(!input.enabled && input.provider === "apple" ? { feedHash: null, feedSecret: null } : {}), ...(feedToken ? { feedHash: calendarHash(feedToken), feedSecret: encryptSecret(feedToken) } : {}),
      ...(reset ? { remoteCalendarId: null, creationUncertain: false, leaseToken: null, leaseUntil: null } : {}) };
    await tx.insert(schema.calendarTargets).values({ id, hqUserId, allianceId: input.allianceId, provider: input.provider, ...values }).onConflictDoUpdate({ target: schema.calendarTargets.id, set: values });
    if (reset) await tx.update(schema.calendarEntries).set({ remoteId: null, appliedRevision: 0, uncertain: false, remoteConfirmed: false }).where(eq(schema.calendarEntries.targetId, id));
    return { id, version: values.version };
  });
}
