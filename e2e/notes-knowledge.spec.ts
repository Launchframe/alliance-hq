import { expect, test, type APIRequestContext } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createBrowserSession, getE2eSql } from "./fixtures/db";
import { createNotesFixture } from "./fixtures/notes";
import { playwrightAuthCookies } from "./fixtures/auth";
import type { KnowledgeCommand, KnowledgeStatus } from "../src/lib/notes/knowledge.shared";

function controls(request: APIRequestContext, headers: Record<string, string>, resourceId: string) {
  const url = `/api/notes/knowledge/resources/${encodeURIComponent(resourceId)}`;
  const status = async (): Promise<KnowledgeStatus> => {
    const response = await request.get(url, { headers });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const command = async (command: KnowledgeCommand["command"]) => {
    const state = await status();
    return request.post(url, { headers, data: { command, requestId: nanoid(), expectedVersion: state.version, expectedContentVersion: state.contentVersion } });
  };
  const process = () => request.post(`${url}/process`, { headers });
  const finish = async () => {
    for (let index = 0; index < 12; index++) {
      if ((await status()).indexState === "completed") return;
      expect((await process()).status()).toBe(200);
    }
    expect((await status()).indexState).toBe("completed");
  };
  return { url, status, command, process, finish };
}

test("knowledge approval, consent, indexing and access are independent and revision fenced", async ({ request }) => {
  const { author, peer, alliance } = await createNotesFixture("officer");
  const sql = getE2eSql();
  const headers = { Cookie: authCookieHeader(author) }, other = { Cookie: authCookieHeader(peer) };
  const created = await request.post("/api/notes", { headers, data: { title: "Zenith", body: `Zenith watch token=synthetic-secret ${"1".repeat(14)}` } });
  const { noteId } = await created.json();
  const resourceId = `note:${noteId}`;
  const api = controls(request, headers, resourceId);
  expect((await request.get(api.url, { headers: other })).status()).toBe(404);
  await sql`UPDATE hq_users SET is_platform_maintainer = 1 WHERE id = ${peer.hqUserId}`;
  expect((await request.get(api.url, { headers: other })).status()).toBe(404);
  const bootstrap = await createBrowserSession(sql);
  expect((await request.get(api.url, { headers: { Cookie: `alliance_hq_session=${bootstrap.sessionId}; authjs.session-token=${author.nextAuthToken}` } })).status()).toBe(403);
  expect((await api.command("index")).status()).toBe(409);
  const initial = await api.status();
  const approval = { command: "approve", requestId: nanoid(), expectedVersion: initial.version, expectedContentVersion: initial.contentVersion };
  const approved = await (await request.post(api.url, { headers, data: approval })).json();
  expect((await (await request.post(api.url, { headers, data: approval })).json()).version).toBe(approved.version);
  expect(await api.status()).toMatchObject({ approved: true, aiAllowed: false, indexState: "none" });
  expect((await api.command("allow_ai")).status()).toBe(200);
  expect((await api.status()).indexState).toBe("none");
  const [before] = await sql`SELECT count(*)::int AS total FROM knowledge_index_jobs WHERE resource_id = ${resourceId}`;
  expect(before.total).toBe(0);
  expect((await api.command("index")).status()).toBe(200);
  await api.finish();
  const query = async (auth: Record<string, string>, mode = "keyword") => {
    const response = await request.post("/api/notes/knowledge/search", { headers: auth, data: { q: "Zenith", mode } });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const own = await query(headers);
  expect(own.evidence).toHaveLength(1);
  expect(JSON.stringify(own)).not.toContain("synthetic-secret");
  expect(JSON.stringify(own)).not.toContain("1".repeat(14));
  expect((await query(other, "semantic")).evidence).toEqual([]);
  const [privateQuery] = await sql`SELECT count(*)::int AS total FROM knowledge_ai_usage WHERE principal_key = ${`hq:${peer.hqUserId}`} AND operation = 'query'`;
  expect(privateQuery.total).toBe(0);
  await sql`INSERT INTO officer_intel_chunks (id, alliance_id, source_type, source_id, locale_code, chunk_text) VALUES (${nanoid()}, ${alliance.allianceId}, 'approved_note', 'legacy', 'en-US', 'Zenith legacy-only')`;
  expect(JSON.stringify(await query(headers))).not.toContain("legacy-only");
  const sharing = await request.put(`/api/notes/${noteId}/sharing`, { headers, data: { expectedVersion: (await api.status()).version, grants: [{ subjectKind: "user", subjectId: peer.hqUserId, role: "edit" }] } });
  expect(sharing.status()).toBe(200);
  expect((await query(other)).evidence).toEqual([]);
  expect((await request.post(api.url, { headers: other, data: { command: "allow_ai", requestId: nanoid(), expectedVersion: 1, expectedContentVersion: 1 } })).status()).toBe(404);
  expect((await api.command("index")).status()).toBe(200);
  await api.finish();
  expect((await query(other, "semantic")).evidence).toHaveLength(1);
  expect((await query(other)).evidence).toHaveLength(1);
  await request.post("/api/notes", { headers: other, data: { title: "Peer private note", body: "Different ownership" } });
  const library = await (await request.get("/api/notes/knowledge/resources", { headers: other })).json();
  expect(library.resources.find((item: { resourceId: string }) => item.resourceId === resourceId)).toMatchObject({ title: "Zenith", isOwner: false });
  expect((await api.command("deny_ai")).status()).toBe(200);
  expect((await query(other)).evidence).toEqual([]);
  expect((await api.status()).approved).toBe(true);
  expect((await api.command("allow_ai")).status()).toBe(200);
  expect((await query(headers)).evidence).toEqual([]);
  await api.command("index"); await api.finish();
  await sql`INSERT INTO knowledge_ai_usage (id, alliance_id, principal_key, operation, input_chars) VALUES (${nanoid()}, ${alliance.allianceId}, ${`hq:${author.hqUserId}`}, 'index', 2000000)`;
  expect((await request.post("/api/notes/knowledge/search", { headers, data: { q: "Zenith", mode: "semantic" } })).status()).toBe(429);
  await sql`UPDATE performance_notes SET body = 'Zenith changed after review' WHERE id = ${noteId}`;
  expect((await api.status()).approved).toBe(false);
  expect((await query(headers)).evidence).toEqual([]);
  const [retained] = await sql`SELECT count(*)::int AS total FROM officer_intel_chunks WHERE resource_id = ${resourceId}`;
  expect(retained.total).toBeGreaterThan(0);
  expect((await request.get(api.url)).status()).toBe(401);
  expect((await request.get("/api/internal/notes/knowledge")).status()).toBe(403);
});

test("index checkpoints survive cancel/retry and become ineligible after role revocation", async ({ request }) => {
  const { author, alliance } = await createNotesFixture();
  const sql = getE2eSql();
  const headers = { Cookie: authCookieHeader(author) };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Recovery", body: "Recovery detail ".repeat(2500) } })).json();
  const resourceId = `note:${noteId}`, api = controls(request, headers, resourceId);
  await api.command("approve"); await api.command("allow_ai"); await api.command("index");
  await sql`UPDATE knowledge_index_jobs SET state = 'running', lease_token = 'retired-lease', lease_expires_at = now() - interval '1 second', attempts = 1 WHERE resource_id = ${resourceId}`;
  const concurrent = await Promise.all([api.process(), api.process()]);
  expect((await Promise.all(concurrent.map((response) => response.json()))).filter((value) => value.processed)).toHaveLength(1);
  expect((await api.status()).completedChunks).toBe(8);
  await api.command("cancel");
  expect((await api.status()).indexState).toBe("cancelled");
  await api.command("retry"); await api.finish();
  const [job] = await sql`SELECT id, cursor, total_chunks FROM knowledge_index_jobs WHERE resource_id = ${resourceId}`;
  const [chunks] = await sql`SELECT count(*)::int AS total, count(DISTINCT chunk_index)::int AS distinct_count FROM officer_intel_chunks WHERE index_job_id = ${job.id}`;
  expect(chunks.total).toBe(job.total_chunks);
  expect(chunks.distinct_count).toBe(job.total_chunks);
  await sql`UPDATE alliance_memberships SET role_id = (SELECT id FROM roles WHERE name = 'viewer') WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${author.hqUserId}`;
  const result = await request.post("/api/notes/knowledge/search", { headers, data: { q: "Recovery" } });
  expect(result.status()).toBe(200);
  expect((await result.json()).evidence).toEqual([]);
  expect((await api.command("deny_ai")).status()).toBe(200);
  expect((await api.command("allow_ai")).status()).toBe(403);
});

test("raw source evidence requires explicit retrieval opt-in and completed review", async ({ request }) => {
  const { author, alliance } = await createNotesFixture();
  const sql = getE2eSql(), id = nanoid();
  const headers = { Cookie: authCookieHeader(author) };
  await sql`INSERT INTO officer_chat_sessions (id, alliance_id, title, status, created_by_hq_user_id) VALUES (${id}, ${alliance.allianceId}, 'Source history', 'imported', ${author.hqUserId})`;
  await sql`INSERT INTO officer_chat_messages (id, alliance_id, session_id, original_text, locale_text, locale_code, sequence_order, history_included) VALUES (${nanoid()}, ${alliance.allianceId}, ${id}, 'Unreviewed discussion', 'Unreviewed discussion', 'und', 0, true)`;
  const api = controls(request, headers, `source:${id}`);
  await sql`INSERT INTO knowledge_history_imports (id, alliance_id, resource_id, kind, state, source_hash, locale) VALUES (${id}, ${alliance.allianceId}, ${`source:${id}`}, 'text', 'review', ${"a".repeat(64)}, 'en-US')`;
  expect((await api.command("approve")).status()).toBe(403);
  await sql`UPDATE officer_chat_messages SET history_reviewed = true WHERE session_id = ${id}`;
  await sql`UPDATE knowledge_history_imports SET state = 'committed' WHERE id = ${id}`;
  await api.command("approve"); await api.command("allow_ai"); await api.command("index"); await api.finish();
  expect((await (await request.post("/api/notes/knowledge/search", { headers, data: { q: "discussion" } })).json()).evidence).toEqual([]);
  const result = await (await request.post("/api/notes/knowledge/search", { headers, data: { q: "discussion", includeSources: true } })).json();
  expect(result.evidence).toHaveLength(1);
  expect(result.evidence[0].evidence.some((item: { locator: string }) => item.locator.startsWith("message:"))).toBe(true);
  await sql`UPDATE officer_chat_messages SET history_included = false WHERE session_id = ${id}`;
  expect((await (await request.post("/api/notes/knowledge/search", { headers, data: { q: "discussion", includeSources: true } })).json()).evidence).toEqual([]);
});

for (const copy of [
  { locale: "", approve: "Approve this version", consent: "Allow AI processing for this resource", index: "Index approved version", process: "Process next batch", indexed: "Indexed", query: "Search terms", find: "Find evidence" },
  { locale: "/pt-BR", approve: "Aprovar esta versão", consent: "Permitir processamento por IA para este recurso", index: "Indexar versão aprovada", process: "Processar próximo lote", indexed: "Indexado", query: "Termos de pesquisa", find: "Encontrar evidências" },
]) test(`knowledge controls require explicit approval and indexing (${copy.locale || "en-US"})`, async ({ page }) => {
  const { author } = await createNotesFixture();
  const headers = { Cookie: authCookieHeader(author) };
  expect((await page.request.post("/api/notes", { headers, data: { title: "Browser knowledge", body: "Browser evidence description" } })).status()).toBe(200);
  const listing = await page.request.get("/api/notes/knowledge/resources?owned=true", { headers });
  expect(listing.status()).toBe(200);
  expect((await listing.json()).resources).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Browser knowledge", isOwner: true })]));
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto(`${copy.locale}/notes?view=knowledge`);
  const panel = page.getByTestId("notes-knowledge");
  await panel.getByRole("button", { name: "Browser knowledge", exact: true }).click();
  await expect(panel.getByRole("button", { name: copy.index, exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: copy.approve, exact: true }).click();
  await expect(panel.getByRole("button", { name: copy.approve, exact: true })).toBeDisabled();
  await panel.getByLabel(copy.consent, { exact: true }).check();
  await panel.getByRole("button", { name: copy.index, exact: true }).click();
  await panel.getByRole("button", { name: copy.process, exact: true }).click();
  await expect(panel.getByText(copy.indexed, { exact: true })).toBeVisible();
  await panel.getByLabel(copy.query, { exact: true }).fill("Browser");
  await panel.getByRole("button", { name: copy.find, exact: true }).click();
  await expect(panel.locator("article")).toHaveCount(1);
  await panel.getByLabel(copy.consent, { exact: true }).uncheck();
  await expect(panel.locator("article")).toHaveCount(0);
});
