import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto/encrypt";
import { CalendarError } from "./types.shared";
import { calendarHash, lockCalendarUser, dirtyCalendarUser } from "./repository.server";
import { calendarAppOrigin } from "./origin.server";
import { exchangeGoogleToken, googleCalendarConfiguration, GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_SCOPES } from "./google-transport.server";

type Flow = { verifier: string; nonce: string; redirectUri: string; clientId: string; accountId: string | null; accountVersion: number };
export const GOOGLE_CALENDAR_COOKIE = "hq-calendar-oauth";
export const googleCalendarCookieName = () => calendarAppOrigin().startsWith("https:") ? `__Host-${GOOGLE_CALENDAR_COOKIE}` : GOOGLE_CALENDAR_COOKIE;

export async function startGoogleCalendar(hqUserId: string) {
  const config = googleCalendarConfiguration(), origin = calendarAppOrigin();
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url");
  const redirectUri = `${origin}/api/calendar/google/callback`;
  await getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    await tx.delete(schema.calendarOauthStates).where(and(eq(schema.calendarOauthStates.hqUserId, hqUserId), lt(schema.calendarOauthStates.expiresAt, new Date())));
    const active = await tx.select({ id: schema.calendarOauthStates.hash }).from(schema.calendarOauthStates).where(eq(schema.calendarOauthStates.hqUserId, hqUserId)).limit(11);
    if (active.length >= 10) throw new CalendarError("rate_limit", 429);
    const [account] = await tx.select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, hqUserId));
    if (account && ["disconnecting", "revoking"].includes(account.status)) throw new CalendarError("busy", 409);
    const flow: Flow = { verifier, nonce, redirectUri, clientId: config.clientId, accountId: account?.id ?? null, accountVersion: account?.version ?? 0 };
    await tx.insert(schema.calendarOauthStates).values({ hash: calendarHash(state), hqUserId, secret: encryptSecret(JSON.stringify(flow)), expiresAt: new Date(Date.now() + 15 * 60_000) });
  });
  const url = new URL(config.authorize);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_CALENDAR_SCOPES, access_type: "offline", prompt: "consent select_account", state, nonce, code_challenge_method: "S256", code_challenge: Buffer.from(calendarHash(verifier), "hex").toString("base64url") }).toString();
  return { state, url: url.href };
}

export async function finishGoogleCalendar(hqUserId: string, state: string, code: string) {
  if (!/^[\w-]{43}$/.test(state) || !code || code.length > 4096) throw new CalendarError("invalid_oauth", 400);
  const config = googleCalendarConfiguration();
  const flow = await getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    const [row] = await tx.delete(schema.calendarOauthStates).where(and(eq(schema.calendarOauthStates.hash, calendarHash(state)), eq(schema.calendarOauthStates.hqUserId, hqUserId), gt(schema.calendarOauthStates.expiresAt, new Date()))).returning();
    if (!row) throw new CalendarError("expired", 409);
    const stored = JSON.parse(decryptSecret(row.secret)) as Flow;
    if (stored.clientId !== config.clientId) throw new CalendarError("stale", 409);
    return stored;
  });
  const issuedAt = Date.now();
  const token = await exchangeGoogleToken({ grant_type: "authorization_code", code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier });
  if (!token.id_token || !token.scope?.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) throw new CalendarError("missing_scope", 400);
  const { payload } = await jwtVerify(token.id_token, createRemoteJWKSet(new URL(config.jwks)), { issuer: config.issuers, audience: config.clientId, algorithms: ["RS256"], clockTolerance: 5 });
  if (payload.nonce !== flow.nonce || payload.azp !== undefined && payload.azp !== config.clientId || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 || typeof payload.email !== "string" || payload.email.length > 320 || payload.email_verified !== true) throw new CalendarError("invalid_identity", 400);
  const subject = payload.sub, email = payload.email;
  return getDb().transaction(async (tx) => {
    await lockCalendarUser(tx, hqUserId);
    let account: typeof schema.calendarAccounts.$inferSelect | undefined = (await tx.select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.hqUserId, hqUserId)).for("update"))[0];
    if ((account?.id ?? null) !== flow.accountId || (account?.version ?? 0) !== flow.accountVersion || account && ["disconnecting", "revoking"].includes(account.status)) throw new CalendarError("stale", 409);
    if (account && account.subject !== subject) {
      const live = await tx.select({ id: schema.calendarTargets.id }).from(schema.calendarTargets).where(and(eq(schema.calendarTargets.accountId, account.id), or(eq(schema.calendarTargets.enabled, true), eq(schema.calendarTargets.cleanup, true)))).limit(1);
      if (live.length || !["revoked", "revocation_uncertain"].includes(account.status)) throw new CalendarError("account_change", 409);
      await tx.delete(schema.calendarAccounts).where(eq(schema.calendarAccounts.id, account.id));
      account = undefined;
    }
    const refreshToken = token.refresh_token ? encryptSecret(token.refresh_token) : account?.subject === subject && account.status === "connected" ? account.refreshToken : null;
    if (!refreshToken) throw new CalendarError("offline_access_required", 400);
    const id = account?.id ?? nanoid();
    const values = { subject, email, refreshToken, accessToken: encryptSecret(token.access_token), expiresAt: new Date(issuedAt + token.expires_in * 1000), status: "connected", version: (account?.version ?? 0) + 1, refreshLeaseToken: null, refreshLeaseUntil: null, updatedAt: new Date() };
    await tx.insert(schema.calendarAccounts).values({ id, hqUserId, ...values }).onConflictDoUpdate({ target: schema.calendarAccounts.id, set: values });
    await dirtyCalendarUser(tx, hqUserId, true);
    return { id, email };
  });
}
