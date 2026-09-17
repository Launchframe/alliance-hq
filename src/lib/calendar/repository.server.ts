import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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

export async function saveCalendarPreferences(hqUserId: string, input: unknown, version: number) {
  const preferences = parseCalendarPreferences(input);
  return getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    const previous = await readCalendarPreferences(tx, hqUserId);
    if (previous.version !== version) throw new CalendarError("stale", 409);
    await tx.insert(schema.calendarPreferences).values({ hqUserId, ...preferences, version: version + 1 }).onConflictDoUpdate({ target: schema.calendarPreferences.hqUserId, set: { ...preferences, version: version + 1 } });
    await tx.update(schema.calendarTargets).set({ nextSyncAt: new Date() }).where(eq(schema.calendarTargets.hqUserId, hqUserId));
    return { ...preferences, version: version + 1 };
  });
}

export async function configureCalendarTarget(hqUserId: string, input: { allianceId: string; provider: string; sources: unknown; enabled: boolean; version: number; rotate?: boolean; cleanup?: boolean }) {
  if (!["apple", "google"].includes(input.provider) || typeof input.enabled !== "boolean" || !Number.isInteger(input.version)) throw new CalendarError("invalid_target");
  const sources = parseCalendarSources(input.sources);
  return getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    if (input.enabled && !await calendarPrincipal(tx, hqUserId, input.allianceId)) throw new CalendarError("forbidden", 403);
    const [existing] = await tx.select().from(schema.calendarTargets).where(and(eq(schema.calendarTargets.hqUserId, hqUserId), eq(schema.calendarTargets.allianceId, input.allianceId), eq(schema.calendarTargets.provider, input.provider)));
    if ((existing?.version ?? 0) !== input.version) throw new CalendarError("stale", 409);
    const id = existing?.id ?? nanoid();
    await lockCalendarTarget(tx, id);
    const [account] = await tx.select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, hqUserId));
    if (input.enabled && input.provider === "google" && account?.status !== "connected") throw new CalendarError("reconnect", 409);
    if (existing?.status === "creating" || existing?.status === "uncertain") throw new CalendarError("uncertain", 409);
    const feedToken = input.provider === "apple" && input.enabled && (!existing?.feedHash || input.rotate) ? randomBytes(32).toString("base64url") : null;
    const values = { sources, enabled: input.enabled, version: input.version + 1, nextSyncAt: new Date(), cleanup: !input.enabled && input.cleanup === true, accountId: input.provider === "google" ? account?.id ?? null : null,
      ...(!input.enabled && input.provider === "apple" ? { feedHash: null, feedSecret: null } : {}), ...(feedToken ? { feedHash: calendarHash(feedToken), feedSecret: encryptSecret(feedToken) } : {}) };
    await tx.insert(schema.calendarTargets).values({ id, hqUserId, allianceId: input.allianceId, provider: input.provider, ...values }).onConflictDoUpdate({ target: schema.calendarTargets.id, set: values });
    return { id, version: values.version };
  });
}
