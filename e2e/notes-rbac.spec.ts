import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createBrowserSession,
  createNativeAlliance,
  getE2eSql,
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
 * HQ notes (`/api/notes`) require Auth.js + `members:write`.
 *
 *   no cookie ──────────────────────────────────────────────────────▶ 401
 *   bootstrap / anonymous browser session ─────────────────────────▶ 403
 *   authenticated viewer ──────────────────────────────────────────▶ 403
 *   officer ───────────────────────────────────────────────────────▶ 200
 */
test.describe("HQ notes RBAC", () => {
  test("no session cookie is unauthorized", async ({ request }) => {
    const list = await request.get("/api/notes");
    expect(list.status(), await list.text()).toBe(401);

    const create = await request.post("/api/notes", {
      data: { body: "should not save" },
    });
    expect(create.status(), await create.text()).toBe(401);

    const patch = await request.patch("/api/notes/note-missing", {
      data: { memberIds: [] },
    });
    expect(patch.status(), await patch.text()).toBe(401);
  });

  test("bootstrap session cannot list or create notes", async ({ request }) => {
    const sql = getE2eSql();
    const sessionId = await mintSessionViaBootstrap(request);

    const [row] = await sql`
      SELECT hq_user_id FROM sessions WHERE id = ${sessionId}
    `;
    expect(row?.hq_user_id).toBeNull();

    const cookie = hqSessionOnlyCookie(sessionId);
    const list = await request.get("/api/notes", {
      headers: { Cookie: cookie },
    });
    expect(list.status(), await list.text()).toBe(403);

    const create = await request.post("/api/notes", {
      headers: { Cookie: cookie },
      data: { body: "bootstrap must not create notes" },
    });
    expect(create.status(), await create.text()).toBe(403);
  });

  test("anonymous browser session row is also denied notes API", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { sessionId } = await createBrowserSession(sql, { hqUserId: null });

    const list = await request.get("/api/notes", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
    });
    expect(list.status(), await list.text()).toBe(403);
  });

  test("authenticated viewer cannot list notes", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NTV${nanoid(4)}`,
      name: "Notes Viewer Test",
    });
    const user = await createAuthenticatedHqSession(
      sql,
      `notes-viewer-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "viewer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${user.sessionId}
    `;

    const list = await request.get("/api/notes", {
      headers: { Cookie: authCookieHeader(user) },
    });
    expect(list.status(), await list.text()).toBe(403);
  });

  test("officer can list notes", async ({ request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `NTO${nanoid(4)}`,
      name: "Notes Officer Test",
    });
    const user = await createAuthenticatedHqSession(
      sql,
      `notes-officer-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${user.sessionId}
    `;

    const list = await request.get("/api/notes", {
      headers: { Cookie: authCookieHeader(user) },
    });
    expect(list.status(), await list.text()).toBe(200);
    const body = (await list.json()) as { notes?: unknown[]; roster?: unknown[] };
    expect(Array.isArray(body.notes)).toBe(true);
    expect(Array.isArray(body.roster)).toBe(true);
  });
});
