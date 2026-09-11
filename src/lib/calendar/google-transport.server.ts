import "server-only";
import { z } from "zod";
import { CalendarError } from "./types.shared";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const GOOGLE_CALENDAR_SCOPES = `openid email ${GOOGLE_CALENDAR_SCOPE}`;
export class GoogleCalendarError extends CalendarError {
  constructor(code: string, readonly providerStatus: number, readonly retryAfter = 60) { super(code, 503); }
}

export function googleCalendarConfiguration() {
  if (process.env.CALENDAR_GOOGLE_TRANSPORT === "disabled") throw new CalendarError("not_configured", 503);
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new CalendarError("not_configured", 503);
  const mock = process.env.CALENDAR_GOOGLE_TEST_ORIGIN;
  if (mock) {
    const url = new URL(mock);
    if (process.env.E2E_TEST !== "true" || process.env.VERCEL || process.env.CALENDAR_GOOGLE_TRANSPORT !== "mock" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || clientId !== "e2e-google-client-id" || clientSecret !== "e2e-google-client-secret") throw new CalendarError("not_configured", 503);
    return { clientId, clientSecret, authorize: `${url.origin}/authorize`, token: `${url.origin}/token`, revoke: `${url.origin}/revoke`, jwks: `${url.origin}/jwks`, issuers: [url.origin], api: `${url.origin}/calendar/v3` };
  }
  if (process.env.E2E_TEST === "true") throw new CalendarError("not_configured", 503);
  return { clientId, clientSecret, authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", revoke: "https://oauth2.googleapis.com/revoke", jwks: "https://www.googleapis.com/oauth2/v3/certs", issuers: ["https://accounts.google.com", "accounts.google.com"], api: "https://www.googleapis.com/calendar/v3" };
}

export function googleCalendarConfigured() {
  try { googleCalendarConfiguration(); return true; } catch { return false; }
}

async function send(url: string, init: RequestInit) {
  try { return await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000), cache: "no-store" }); }
  catch { throw new GoogleCalendarError("provider_unavailable", 0); }
}

const tokenSchema = z.object({ access_token: z.string().min(1).max(16384), token_type: z.string(), expires_in: z.number().int().positive().max(86400), refresh_token: z.string().min(1).max(16384).optional(), id_token: z.string().min(1).max(32768).optional(), scope: z.string().optional() });
export async function exchangeGoogleToken(parameters: Record<string, string>) {
  const config = googleCalendarConfiguration();
  const response = await send(config.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...parameters, client_id: config.clientId, client_secret: config.clientSecret }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new GoogleCalendarError(body?.error === "invalid_grant" ? "reconnect" : "provider_unavailable", response.status);
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== "bearer") throw new GoogleCalendarError("invalid_provider_response", 502);
  if (parsed.data.scope && !parsed.data.scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) throw new GoogleCalendarError("reconnect", 403);
  return parsed.data;
}

export async function revokeGoogleToken(token: string) {
  const response = await send(googleCalendarConfiguration().revoke, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
  if (!response.ok && response.status !== 400) throw new GoogleCalendarError("provider_unavailable", response.status);
}

export async function googleCalendarApi<T>(accessToken: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, etag?: string): Promise<T> {
  if (!path.startsWith("/calendars") || /[\r\n]/.test(path)) throw new CalendarError("invalid_provider_path", 503);
  const response = await send(`${googleCalendarConfiguration().api}${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after"));
    throw new GoogleCalendarError(response.status === 401 ? "reconnect" : "provider_unavailable", response.status, Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60);
  }
  if (response.status === 204) return undefined as T;
  return await response.json().catch(() => { throw new GoogleCalendarError("invalid_provider_response", 502); }) as T;
}
