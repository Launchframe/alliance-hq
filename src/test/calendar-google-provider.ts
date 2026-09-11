import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

type Identity = { subject: string; email: string };
type Document = Record<string, unknown> & { id: string; etag: string; status?: string };
type Calendar = { id: string; owner: string; summary: string; timeZone: string; etag: string; events: Map<string, Document> };
const scope = "openid email https://www.googleapis.com/auth/calendar.app.created";

export async function startCalendarGoogleProvider() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "calendar-e2e", alg: "RS256", use: "sig" };
  const calendars = new Map<string, Calendar>(), access = new Map<string, Identity>(), refresh = new Map<string, Identity>();
  const codes = new Map<string, { identity: Identity; nonce: string; challenge: string; redirect: string }>();
  const controls = { subject: "calendar-test-subject", email: "calendar-provider@example.test", badNonce: false, rejectRefresh: false, failCalendarAfterCreate: false, failEventAfterCreate: false, rateLimit: false, beforeEventRead: null as (() => Promise<void>) | null };
  const counts = { calendarsCreated: 0, eventsCreated: 0, eventPatches: 0, eventDeletes: 0, refreshes: 0 };
  let origin = "", revision = 0;
  const etag = () => `"${++revision}"`;
  const send = (response: ServerResponse, status: number, body: unknown = {}) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(status === 204 ? undefined : JSON.stringify(body)); };
  async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > 1_000_000) throw new Error("request_limit"); chunks.push(value); }
    const text = Buffer.concat(chunks).toString("utf8");
    return request.headers["content-type"]?.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(text)) : text ? JSON.parse(text) : {};
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname === "/jwks") return send(response, 200, { keys: [jwk] });
      if (url.pathname === "/authorize") {
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
        if (redirect.hostname !== "localhost" || redirect.protocol !== "http:" || redirect.pathname !== "/api/calendar/google/callback" || url.searchParams.get("client_id") !== "e2e-google-client-id") return send(response, 400);
        const code = randomUUID();
        codes.set(code, { identity: { subject: controls.subject, email: controls.email }, nonce: url.searchParams.get("nonce") ?? "", challenge: url.searchParams.get("code_challenge") ?? "", redirect: redirect.href });
        redirect.searchParams.set("state", url.searchParams.get("state") ?? ""); redirect.searchParams.set("code", code);
        response.writeHead(302, { Location: redirect.href }); response.end(); return;
      }
      if (url.pathname === "/token") {
        const data = await body(request);
        if (data.client_id !== "e2e-google-client-id" || data.client_secret !== "e2e-google-client-secret") return send(response, 400, { error: "invalid_client" });
        let identity: Identity | undefined, idToken: string | undefined;
        if (data.grant_type === "refresh_token") {
          counts.refreshes++;
          identity = refresh.get(String(data.refresh_token));
          if (controls.rejectRefresh) identity = undefined;
        } else {
          const stored = codes.get(String(data.code)); codes.delete(String(data.code));
          if (stored && stored.redirect === data.redirect_uri && createHash("sha256").update(String(data.code_verifier)).digest("base64url") === stored.challenge) {
            identity = stored.identity;
            idToken = await new SignJWT({ email: identity.email, email_verified: true, nonce: controls.badNonce ? "wrong" : stored.nonce }).setProtectedHeader({ alg: "RS256", kid: "calendar-e2e" }).setIssuer(origin).setAudience("e2e-google-client-id").setSubject(identity.subject).setIssuedAt().setExpirationTime("1h").sign(privateKey);
          }
        }
        if (!identity) return send(response, 400, { error: "invalid_grant" });
        const accessToken = randomUUID(); access.set(accessToken, identity);
        const refreshToken = data.grant_type === "refresh_token" ? undefined : randomUUID();
        if (refreshToken) refresh.set(refreshToken, identity);
        return send(response, 200, { token_type: "Bearer", access_token: accessToken, expires_in: 3600, scope, refresh_token: refreshToken, id_token: idToken });
      }
      if (url.pathname === "/revoke") {
        const data = await body(request); access.delete(String(data.token)); refresh.delete(String(data.token)); return send(response, 200);
      }
      const identity = access.get(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
      if (!identity) return send(response, 401);
      if (controls.rateLimit) { response.setHeader("Retry-After", "60"); return send(response, 429); }
      const parts = url.pathname.replace(/^\/calendar\/v3\//, "").split("/").map(decodeURIComponent);
      if (parts[0] !== "calendars") return send(response, 404);
      if (parts.length === 1 && request.method === "POST") {
        const data = await body(request), id = `calendar-${randomUUID()}`;
        calendars.set(id, { id, owner: identity.subject, summary: String(data.summary), timeZone: String(data.timeZone), etag: etag(), events: new Map() }); counts.calendarsCreated++;
        if (controls.failCalendarAfterCreate) { controls.failCalendarAfterCreate = false; return send(response, 503); }
        return send(response, 200, { id, summary: data.summary, timeZone: data.timeZone });
      }
      const calendar = calendars.get(parts[1]);
      if (!calendar) return send(response, 404);
      if (calendar.owner !== identity.subject) return send(response, 403);
      if (parts.length === 2) {
        if (request.method === "PATCH") { const data = await body(request); calendar.timeZone = String(data.timeZone); calendar.etag = etag(); }
        return send(response, 200, { id: calendar.id, summary: calendar.summary, timeZone: calendar.timeZone, etag: calendar.etag });
      }
      if (parts[2] !== "events") return send(response, 404);
      if (parts.length === 3 && request.method === "POST") {
        const data = await body(request), id = String(data.id);
        if (!/^[a-v0-9]{5,1024}$/.test(id)) return send(response, 400);
        if (calendar.events.has(id)) return send(response, 409);
        const event: Document = { ...data, id, etag: etag(), status: "confirmed" };
        calendar.events.set(id, event); counts.eventsCreated++;
        if (controls.failEventAfterCreate) { controls.failEventAfterCreate = false; return send(response, 503); }
        return send(response, 200, event);
      }
      if (request.method === "GET" && controls.beforeEventRead) { const run = controls.beforeEventRead; controls.beforeEventRead = null; await run(); }
      const event = calendar.events.get(parts[3]);
      if (!event) return send(response, 404);
      if (event.status === "cancelled") return send(response, 410);
      if (request.headers["if-match"] && request.headers["if-match"] !== event.etag) return send(response, 412);
      if (request.method === "DELETE") { event.status = "cancelled"; event.etag = etag(); counts.eventDeletes++; return send(response, 204); }
      if (request.method === "PATCH") { Object.assign(event, await body(request), { etag: etag() }); counts.eventPatches++; }
      return send(response, 200, event);
    })().catch(() => { if (!response.headersSent) send(response, 500); else response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock_listen_failed");
  origin = `http://localhost:${address.port}`;
  return { origin, controls, calendars, counts, stop: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}
