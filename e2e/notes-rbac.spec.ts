import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createBrowserSession,
  createNativeAlliance,
  getE2eSql,
} from "./fixtures/db";

function hqSessionOnlyCookie(sessionId: string): string {
  return `alliance_hq_session=${sessionId}`;
}

async function createPrivateNoteFixture(request: APIRequestContext) {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `NTP${nanoid(4)}`,
    name: "Notes privacy fixture",
  });
  const author = await createAuthenticatedHqSession(sql, `note-author-${nanoid(8)}@e2e.test`);
  const peer = await createAuthenticatedHqSession(sql, `note-peer-${nanoid(8)}@e2e.test`);
  for (const user of [author, peer]) {
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`UPDATE sessions SET current_alliance_id = ${alliance.allianceId} WHERE id = ${user.sessionId}`;
  }
  const member = await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Private note subject",
  });
  const created = await request.post("/api/notes", {
    headers: { Cookie: authCookieHeader(author) },
    data: { body: "Private officer observation", memberIds: [member.ashedMemberId] },
  });
  expect(created.status(), await created.text()).toBe(200);
  const { noteId } = await created.json() as { noteId: string };
  return { author, peer, member, noteId };
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

  test("private notes are not readable or editable by another alliance officer", async ({ request }) => {
    const { author, peer, noteId } = await createPrivateNoteFixture(request);
    const own = await request.get(`/api/notes/${noteId}`, {
      headers: { Cookie: authCookieHeader(author) },
    });
    expect(own.status(), await own.text()).toBe(200);
    const list = await request.get("/api/notes", {
      headers: { Cookie: authCookieHeader(peer) },
    });
    expect(list.status(), await list.text()).toBe(200);
    const body = await list.json() as { notes: Array<{ id: string }> };
    expect(body.notes.map((note) => note.id)).not.toContain(noteId);
    const detail = await request.get(`/api/notes/${noteId}`, {
      headers: { Cookie: authCookieHeader(peer) },
    });
    expect(detail.status(), await detail.text()).toBe(404);
    const edit = await request.patch(`/api/notes/${noteId}`, {
      headers: { Cookie: authCookieHeader(peer) },
      data: { memberIds: [] },
    });
    expect(edit.status(), await edit.text()).toBe(404);
  });

  test("commander profiles do not expose another officer's private notes", async ({ request }) => {
    const { author, peer, member, noteId } = await createPrivateNoteFixture(request);
    const own = await request.get(`/api/members/${member.ashedMemberId}`, {
      headers: { Cookie: authCookieHeader(author) },
    });
    expect(own.status(), await own.text()).toBe(200);
    const ownProfile = await own.json() as { hqNotes: Array<{ id: string }> };
    expect(ownProfile.hqNotes.map((note) => note.id)).toContain(noteId);
    const other = await request.get(`/api/members/${member.ashedMemberId}`, {
      headers: { Cookie: authCookieHeader(peer) },
    });
    expect(other.status(), await other.text()).toBe(200);
    const peerProfile = await other.json() as { hqNotes: Array<{ id: string }> };
    expect(peerProfile.hqNotes.map((note) => note.id)).not.toContain(noteId);
  });

  test("workspace cookies cannot substitute a different signed-in principal", async ({ request }) => {
    const { author, peer, noteId } = await createPrivateNoteFixture(request);
    const response = await request.get(`/api/notes/${noteId}`, {
      headers: { Cookie: authCookieHeader({ sessionId: author.sessionId, nextAuthToken: peer.nextAuthToken }) },
    });
    expect(response.status(), await response.text()).toBe(403);
    const [resource] = await getE2eSql()`SELECT owner_hq_user_id FROM knowledge_resources WHERE id = ${`note:${noteId}`}`;
    expect(resource.owner_hq_user_id).toBe(author.hqUserId);
  });

  test("explicit grants distinguish reading and editing without changing ownership", async ({ request }) => {
    const { author, peer, member, noteId } = await createPrivateNoteFixture(request);
    const sql = getE2eSql();
    const resourceId = `note:${noteId}`;
    const [resource] = await sql`SELECT alliance_id FROM knowledge_resources WHERE id = ${resourceId}`;
    const grantId = nanoid();
    await sql`INSERT INTO knowledge_resource_grants (id, resource_id, alliance_id, subject_kind, subject_id, role)
      VALUES (${grantId}, ${resourceId}, ${resource.alliance_id}, 'user', ${peer.hqUserId}, 'read')`;
    const readable = await request.get(`/api/notes/${noteId}`, { headers: { Cookie: authCookieHeader(peer) } });
    expect(readable.status(), await readable.text()).toBe(200);
    expect((await readable.json()).note.canEdit).toBe(false);
    const denied = await request.patch(`/api/notes/${noteId}`, { headers: { Cookie: authCookieHeader(peer) }, data: { memberIds: [] } });
    expect(denied.status(), await denied.text()).toBe(404);
    await sql`UPDATE knowledge_resource_grants SET role = 'edit' WHERE id = ${grantId}`;
    const editable = await request.patch(`/api/notes/${noteId}`, {
      headers: { Cookie: authCookieHeader(peer) }, data: { memberIds: [member.ashedMemberId] },
    });
    expect(editable.status(), await editable.text()).toBe(200);
    const [owner] = await sql`SELECT owner_hq_user_id FROM knowledge_resources WHERE id = ${resourceId}`;
    expect(owner.owner_hq_user_id).toBe(author.hqUserId);
  });

  test("Discord captures bind once to HQ and retain their immutable source", async ({ request }) => {
    const { author, peer } = await createPrivateNoteFixture(request);
    const sql = getE2eSql();
    const [session] = await sql`SELECT current_alliance_id FROM sessions WHERE id = ${author.sessionId}`;
    const noteId = nanoid();
    const discordId = `discord-note-${nanoid()}`;
    await sql`INSERT INTO performance_notes (id, alliance_id, kind, intake_mode, body, source, created_by_discord_user_id)
      VALUES (${noteId}, ${session.current_alliance_id}, 'note', 'thought', 'Discord capture before HQ linking', 'discord', ${discordId})`;
    const [unbound] = await sql`SELECT ownership_state FROM knowledge_resources WHERE id = ${`note:${noteId}`}`;
    expect(unbound.ownership_state).toBe("discord");
    await sql`INSERT INTO discord_hq_links (discord_user_id, hq_user_id, linked_at) VALUES (${discordId}, ${author.hqUserId}, now())`;
    const claimed = await request.get(`/api/notes/${noteId}`, { headers: { Cookie: authCookieHeader(author) } });
    expect(claimed.status(), await claimed.text()).toBe(200);
    expect((await claimed.json()).note.source).toBe("discord");
    await sql`UPDATE discord_hq_links SET hq_user_id = ${peer.hqUserId} WHERE discord_user_id = ${discordId}`;
    const denied = await request.get(`/api/notes/${noteId}`, { headers: { Cookie: authCookieHeader(peer) } });
    expect(denied.status(), await denied.text()).toBe(404);
    const [bound] = await sql`SELECT ownership_state, owner_hq_user_id FROM knowledge_resources WHERE id = ${`note:${noteId}`}`;
    expect(bound).toMatchObject({ ownership_state: "hq", owner_hq_user_id: author.hqUserId });
    await expect(sql`UPDATE performance_notes SET source = 'web' WHERE id = ${noteId}`).rejects.toMatchObject({ code: "23514" });
  });
});
