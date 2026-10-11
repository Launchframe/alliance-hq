import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authCookieHeader,
  createAuthenticatedHqSession,
  createPlatformMaintainerSession,
  getE2eSql,
} from "./fixtures/db";

/** Matches LASTRANK_SYNC_TOKEN in scripts/e2e-runtime.mjs. */
const E2E_TOKEN = "e2e-lastrank-sync-token-not-for-production";

const ROUTES = [
  "/api/internal/lastrank/remote-sync/plan",
  "/api/internal/lastrank/remote-sync/apply",
] as const;

async function mintBootstrapCookie(request: APIRequestContext): Promise<string> {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const setCookie = bootstrap.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/alliance_hq_session=([^;]+)/);
  if (!match?.[1]) throw new Error("Missing alliance_hq_session in Set-Cookie");
  return `alliance_hq_session=${match[1]}`;
}

/**
 * Remote LastRank sync is token-only (maintainer CLI). Sessions never grant access.
 *
 *   no Authorization ─────────────────────────────▶ 403
 *   bootstrap session cookie ─────────────────────▶ 403
 *   platform maintainer session (no token) ───────▶ 403
 *   wrong bearer token ───────────────────────────▶ 403
 *   correct token + invalid body ─────────────────▶ 400 (auth passed, nothing written)
 */
test.describe("LastRank remote sync auth", () => {
  for (const route of ROUTES) {
    test(`${route} rejects requests without the token`, async ({ request }) => {
      const sql = getE2eSql();
      const bootstrapCookie = await mintBootstrapCookie(request);
      const member = await createAuthenticatedHqSession(
        sql,
        `lastrank-remote-${nanoid(6)}@e2e.test`,
      );
      const maintainer = await createPlatformMaintainerSession(sql);

      const attempts: Array<Record<string, string>> = [
        {},
        { Cookie: bootstrapCookie },
        { Cookie: authCookieHeader(member) },
        { Cookie: authCookieHeader(maintainer) },
        { Authorization: `Bearer ${"x".repeat(E2E_TOKEN.length)}` },
        { Authorization: E2E_TOKEN },
      ];
      for (const headers of attempts) {
        const response = await request.post(route, { headers, data: {} });
        expect(response.status(), await response.text()).toBe(403);
      }
    });

    test(`${route} accepts the token and validates the body`, async ({ request }) => {
      const response = await request.post(route, {
        headers: { Authorization: `Bearer ${E2E_TOKEN}` },
        data: { version: 1 },
      });
      expect(response.status(), await response.text()).toBe(400);
    });
  }
});
