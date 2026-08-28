import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  createAuthenticatedHqSession,
  createBrowserSession,
  createPlatformMaintainerSession,
  getE2eSql,
  authCookieHeader,
} from "./fixtures/db";

function hqSessionOnlyCookie(sessionId: string): string {
  return `alliance_hq_session=${sessionId}`;
}

function parseAllianceHqSessionId(
  setCookieHeader: string | string[] | undefined,
): string {
  const parts = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const part of parts) {
    const match = part.match(/alliance_hq_session=([^;]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error("Missing alliance_hq_session in Set-Cookie");
}

async function mintSessionViaBootstrap(
  request: APIRequestContext,
): Promise<string> {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", {
    maxRedirects: 0,
  });
  expect(bootstrap.status(), await bootstrap.text()).toBeGreaterThanOrEqual(300);
  expect(bootstrap.status()).toBeLessThan(400);
  return parseAllianceHqSessionId(bootstrap.headers()["set-cookie"]);
}

/**
 * Anonymous session RBAC — bootstrap mints hq_user_id = null; must not pass admin guards.
 *
 *   GET /api/auth/bootstrap ──▶ alliance_hq_session (hqUserId null)
 *        ├── GET  /api/admin/users ───────────────────────────────▶ 403
 *        └── PATCH /api/admin/users (grant hq:admin) ─────────────▶ 403
 *
 *   platform maintainer session ── GET /api/admin/users ───────────▶ 200
 */
test.describe("Anonymous bootstrap session RBAC", () => {
  test("bootstrap session cannot list admin users", async ({ request }) => {
    const sql = getE2eSql();
    const sessionId = await mintSessionViaBootstrap(request);

    const [row] = await sql`
      SELECT hq_user_id FROM sessions WHERE id = ${sessionId}
    `;
    expect(row?.hq_user_id).toBeNull();

    const list = await request.get("/api/admin/users", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
    });
    expect(list.status(), await list.text()).toBe(403);
    const body = (await list.json()) as { error?: string };
    expect(body.error).toMatch(/forbidden/i);
  });

  test("bootstrap session cannot grant platform maintainer", async ({ request }) => {
    const sql = getE2eSql();
    const sessionId = await mintSessionViaBootstrap(request);
    const target = await createAuthenticatedHqSession(
      sql,
      `rbac-target-${nanoid(6)}@e2e.test`,
    );

    const patch = await request.patch("/api/admin/users", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
      data: {
        hqUserId: target.hqUserId,
        isPlatformMaintainer: true,
      },
    });
    expect(patch.status(), await patch.text()).toBe(403);

    const [user] = await sql`
      SELECT is_platform_maintainer
      FROM hq_users
      WHERE id = ${target.hqUserId}
    `;
    expect(user?.is_platform_maintainer).toBe(0);
  });

  test("anonymous browser session row is also denied admin users API", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { sessionId } = await createBrowserSession(sql, { hqUserId: null });

    const list = await request.get("/api/admin/users", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
    });
    expect(list.status(), await list.text()).toBe(403);
  });

  test("authenticated non-maintainer cannot list admin users", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const member = await createAuthenticatedHqSession(
      sql,
      `rbac-member-${nanoid(6)}@e2e.test`,
    );

    const list = await request.get("/api/admin/users", {
      headers: { Cookie: authCookieHeader(member) },
    });
    expect(list.status(), await list.text()).toBe(403);
  });

  test("bootstrap session cannot list VS inventory item defs", async ({
    request,
  }) => {
    const sessionId = await mintSessionViaBootstrap(request);

    const list = await request.get("/api/admin/vs-inventory-item-defs", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
    });
    expect(list.status(), await list.text()).toBe(403);
  });

  test("bootstrap session cannot save VS push profile", async ({ request }) => {
    const sessionId = await mintSessionViaBootstrap(request);

    const save = await request.put("/api/tools/vs-calculator/push-profile", {
      headers: {
        Cookie: hqSessionOnlyCookie(sessionId),
        "Content-Type": "application/json",
      },
      data: {
        payload: { heroes: [], plannerSpendMode: "free_to_play" },
      },
    });
    expect(save.status(), await save.text()).toBeGreaterThanOrEqual(400);
    expect(save.status()).toBeLessThan(500);
  });

  test("platform maintainer can list admin users", async ({ request }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);

    const list = await request.get("/api/admin/users", {
      headers: { Cookie: authCookieHeader(maintainer) },
    });
    expect(list.status(), await list.text()).toBe(200);
    const body = (await list.json()) as { users?: unknown[] };
    expect(Array.isArray(body.users)).toBe(true);
  });

  test("bootstrap session cannot search admin alliances", async ({ request }) => {
    const sessionId = await mintSessionViaBootstrap(request);

    const list = await request.get("/api/admin/alliances?q=LFgo&limit=5", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
    });
    expect(list.status(), await list.text()).toBe(403);
    const body = (await list.json()) as { error?: string };
    expect(body.error).toMatch(/forbidden/i);
  });

  test("authenticated non-maintainer cannot search admin alliances", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const member = await createAuthenticatedHqSession(
      sql,
      `rbac-alliances-${nanoid(6)}@e2e.test`,
    );

    const list = await request.get("/api/admin/alliances?q=test&limit=5", {
      headers: { Cookie: authCookieHeader(member) },
    });
    expect(list.status(), await list.text()).toBe(403);
  });

  test("platform maintainer can search admin alliances", async ({ request }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);

    const list = await request.get("/api/admin/alliances?limit=5&sort=name", {
      headers: { Cookie: authCookieHeader(maintainer) },
    });
    expect(list.status(), await list.text()).toBe(200);
    const body = (await list.json()) as { alliances?: unknown[]; total?: number };
    expect(Array.isArray(body.alliances)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("protected API routes return 401 without a session cookie", async ({
    request,
  }) => {
    const summary = await request.get("/api/dashboard/summary");
    expect(summary.status(), await summary.text()).toBe(401);
  });
});
