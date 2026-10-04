import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto/encrypt";
import { CalendarError } from "./types.shared";
import { lockCalendarTarget, lockCalendarUser } from "./repository.server";
import { exchangeGoogleToken, googleCalendarApi, GoogleCalendarError, revokeGoogleToken } from "./google-transport.server";

type Account = typeof schema.calendarAccounts.$inferSelect;
export type GoogleAccess = { token: string; ciphertext: string; accountId: string; accountVersion: number; subject: string };

export async function googleRequest<T>(access: GoogleAccess, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, etag?: string): Promise<T> {
  try { return await googleCalendarApi<T>(access.token, method, path, body, etag); }
  catch (error) {
    if (error instanceof GoogleCalendarError && error.providerStatus === 401) await getDb().update(schema.calendarAccounts).set({ accessToken: null }).where(and(eq(schema.calendarAccounts.id, access.accountId), eq(schema.calendarAccounts.version, access.accountVersion), eq(schema.calendarAccounts.accessToken, access.ciphertext)));
    throw error;
  }
}

export async function googleAccess(accountId: string, hqUserId: string, cleanup = false): Promise<GoogleAccess> {
  const db = getDb();
  const [account] = await db.select().from(schema.calendarAccounts).where(and(eq(schema.calendarAccounts.id, accountId), eq(schema.calendarAccounts.hqUserId, hqUserId)));
  if (!account || !(account.status === "connected" || cleanup && account.status === "disconnecting")) throw new CalendarError("reconnect", 409);
  const access = (value: string, ciphertext = account.accessToken ?? ""): GoogleAccess => ({ token: value, ciphertext, accountId, accountVersion: account.version, subject: account.subject });
  const now = Date.now();
  if (account.status === "disconnecting" && now - account.updatedAt.getTime() > 24 * 60 * 60_000) throw new CalendarError("cleanup_expired", 409);
  if (account.accessToken && account.expiresAt && account.expiresAt.getTime() > now + 60_000) return access(decryptSecret(account.accessToken));
  if (!account.refreshToken) throw new CalendarError("reconnect", 409);
  const lease = randomUUID();
  const [claimed] = await db.update(schema.calendarAccounts).set({ refreshLeaseToken: lease, refreshLeaseUntil: new Date(now + 30_000) }).where(and(eq(schema.calendarAccounts.id, accountId), eq(schema.calendarAccounts.version, account.version), eq(schema.calendarAccounts.status, account.status), or(isNull(schema.calendarAccounts.refreshLeaseUntil), lt(schema.calendarAccounts.refreshLeaseUntil, new Date(now))))).returning();
  if (!claimed) {
    if (account.accessToken && account.expiresAt && account.expiresAt.getTime() > now + 15_000) return access(decryptSecret(account.accessToken));
    throw new CalendarError("busy", 409);
  }
  try {
    const token = await exchangeGoogleToken({ grant_type: "refresh_token", refresh_token: decryptSecret(account.refreshToken) });
    const [saved] = await db.update(schema.calendarAccounts).set({ accessToken: encryptSecret(token.access_token), ...(token.refresh_token ? { refreshToken: encryptSecret(token.refresh_token) } : {}), expiresAt: new Date(now + token.expires_in * 1000), refreshLeaseToken: null, refreshLeaseUntil: null })
      .where(and(eq(schema.calendarAccounts.id, accountId), eq(schema.calendarAccounts.version, account.version), eq(schema.calendarAccounts.refreshLeaseToken, lease), eq(schema.calendarAccounts.status, account.status))).returning();
    if (!saved) throw new CalendarError("stale", 409);
    return access(token.access_token, saved.accessToken ?? "");
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.code === "reconnect") await db.update(schema.calendarAccounts).set({ accessToken: null, refreshToken: null, status: account.status === "disconnecting" ? "disconnecting" : "reconnect" }).where(and(eq(schema.calendarAccounts.id, accountId), eq(schema.calendarAccounts.version, account.version), eq(schema.calendarAccounts.refreshLeaseToken, lease)));
    throw error;
  } finally {
    await db.update(schema.calendarAccounts).set({ refreshLeaseToken: null, refreshLeaseUntil: null }).where(and(eq(schema.calendarAccounts.id, accountId), eq(schema.calendarAccounts.refreshLeaseToken, lease)));
  }
}

async function revokeAndClear(account: Account) {
  let confirmed = false;
  try {
    const encrypted = account.refreshToken ?? account.accessToken;
    if (encrypted) await revokeGoogleToken(decryptSecret(encrypted));
    confirmed = true;
  } catch {}
  await getDb().update(schema.calendarAccounts).set({ status: confirmed ? "revoked" : "revocation_uncertain", refreshToken: null, accessToken: null, expiresAt: null, refreshLeaseToken: null, refreshLeaseUntil: null })
    .where(and(eq(schema.calendarAccounts.id, account.id), eq(schema.calendarAccounts.version, account.version), eq(schema.calendarAccounts.status, "revoking")));
}

export async function disconnectGoogleCalendar(hqUserId: string, cleanup: boolean, version: number) {
  const account = await getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    const [row] = await tx.select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, hqUserId)).for("update");
    if (!row || row.version !== version) throw new CalendarError("stale", 409);
    const targets = await tx.select().from(schema.calendarTargets).where(and(eq(schema.calendarTargets.hqUserId, hqUserId), eq(schema.calendarTargets.provider, "google"))).orderBy(asc(schema.calendarTargets.id));
    let pending = 0;
    for (const candidate of targets) {
      await lockCalendarTarget(tx, candidate.id);
      const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, candidate.id));
      if (!target) continue;
      const remove = cleanup && !!target.remoteCalendarId && target.accountId === row.id;
      if (remove) pending++;
      await tx.update(schema.calendarTargets).set({ enabled: false, cleanup: remove, version: target.version + 1, generation: target.generation + 1, nextSyncAt: new Date(), status: remove ? "cleanup" : target.creationUncertain ? "uncertain" : "disabled" }).where(eq(schema.calendarTargets.id, target.id));
    }
    await tx.delete(schema.calendarOauthStates).where(eq(schema.calendarOauthStates.hqUserId, hqUserId));
    const [saved] = await tx.update(schema.calendarAccounts).set({ status: pending ? "disconnecting" : "revoking", version: row.version + 1, refreshLeaseToken: null, refreshLeaseUntil: null, updatedAt: new Date() }).where(eq(schema.calendarAccounts.id, row.id)).returning();
    return saved;
  });
  if (account.status === "revoking") await revokeAndClear(account);
}

export async function finalizeGoogleDisconnects() {
  const accounts = await getDb().select().from(schema.calendarAccounts).where(or(eq(schema.calendarAccounts.status, "disconnecting"), eq(schema.calendarAccounts.status, "revoking"))).limit(10);
  for (const account of accounts) {
    const ready = await getDb().transaction(async (tx) => {
      await lockCalendarUser(tx, account.hqUserId);
      const [current] = await tx.select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.id, account.id)).for("update");
      if (!current || current.version !== account.version || !["disconnecting", "revoking"].includes(current.status)) return null;
      const targets = await tx.select().from(schema.calendarTargets).where(and(eq(schema.calendarTargets.accountId, account.id), eq(schema.calendarTargets.cleanup, true))).orderBy(asc(schema.calendarTargets.id));
      const expired = Date.now() - current.updatedAt.getTime() > 24 * 60 * 60_000 || !current.refreshToken && !current.accessToken;
      if (targets.length && !expired) return null;
      for (const candidate of targets) {
        await lockCalendarTarget(tx, candidate.id);
        const [target] = await tx.select().from(schema.calendarTargets).where(eq(schema.calendarTargets.id, candidate.id));
        if (target?.cleanup) await tx.update(schema.calendarTargets).set({ cleanup: false, status: "failed", generation: target.generation + 1 }).where(eq(schema.calendarTargets.id, target.id));
      }
      const [saved] = await tx.update(schema.calendarAccounts).set({ status: "revoking" }).where(eq(schema.calendarAccounts.id, account.id)).returning();
      return saved;
    });
    if (ready) await revokeAndClear(ready);
  }
}
