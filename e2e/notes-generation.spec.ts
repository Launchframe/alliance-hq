import { expect, test, type APIRequestContext } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createBrowserSession, getE2eSql } from "./fixtures/db";
import { createNotesFixture } from "./fixtures/notes";
import { playwrightAuthCookies } from "./fixtures/auth";
import { captureTaskSchema } from "../src/lib/notes/intake.shared";
import { generationBody, type GenerationResult } from "../src/lib/notes/generation.shared";

async function indexed(request: APIRequestContext, auth: ReturnType<typeof authCookieHeader>, body = "Follow up with the team about Zenith.") {
  const headers = { Cookie: auth };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Zenith evidence", body } })).json();
  const resourceId = `note:${noteId}`, url = `/api/notes/knowledge/resources/${encodeURIComponent(resourceId)}`;
  for (const command of ["approve", "allow_ai", "index"]) {
    const state = await (await request.get(url, { headers })).json();
    expect((await request.post(url, { headers, data: { command, requestId: nanoid(), expectedVersion: state.version, expectedContentVersion: state.contentVersion } })).status()).toBe(200);
  }
  for (let at = 0; at < 15; at++) {
    if ((await (await request.get(url, { headers })).json()).indexState === "completed") return { noteId, resourceId, headers, url };
    await request.post(`${url}/process`, { headers });
  }
  throw new Error("Index did not complete");
}
async function finish(request: APIRequestContext, headers: Record<string, string>, id: string): Promise<GenerationResult> {
  for (let at = 0; at < 35; at++) {
    const response = await request.get(`/api/notes/generation/${id}`, { headers });
    expect(response.status()).toBe(200);
    const job = await response.json();
    if (job.state === "ready") return job;
    expect(job.state).toBe("pending");
    expect((await request.post(`/api/notes/generation/${id}/process`, { headers })).status()).toBe(200);
  }
  throw new Error("Generation did not complete");
}

test("synthesis stays reviewable and creates selected tasks only on idempotent acceptance", async ({ request }) => {
  const { author, peer, alliance } = await createNotesFixture("officer");
  const source = await indexed(request, authCookieHeader(author));
  const response = await request.post("/api/notes/generation", { headers: source.headers, data: { kind: "synthesize", locale: "en-US", resourceIds: [source.resourceId], requestId: nanoid() } });
  expect(response.status()).toBe(200);
  const { jobId } = await response.json();
  expect((await request.get(`/api/notes/generation/${jobId}`, { headers: { Cookie: authCookieHeader(peer) } })).status()).toBe(404);
  let job = await finish(request, source.headers, jobId);
  const sql = getE2eSql();
  const [before] = await sql`SELECT count(*)::int AS total FROM officer_action_items WHERE alliance_id = ${alliance.allianceId}`;
  expect(before.total).toBe(0);
  const proposed = job.parts[0].actions[0];
  const actions = [captureTaskSchema.parse({ ...proposed, actionKey: "0:0", included: true, title: "Reviewed follow-up", status: "in_progress", priority: "high" })];
  const review = { title: "Reviewed synthesis", body: `${generationBody(job.parts)}\n\nHuman correction`, actions };
  const saved = await request.post(`/api/notes/generation/${jobId}/review`, { headers: source.headers, data: { ...review, expectedVersion: job.version, requestId: nanoid() } });
  expect(saved.status()).toBe(200); job = await saved.json();
  expect(job.review?.body).toContain("Human correction");
  const payload = { ...review, expectedVersion: job.version, requestId: nanoid() };
  const accepted = await request.post(`/api/notes/generation/${jobId}`, { headers: source.headers, data: payload });
  expect(accepted.status()).toBe(200);
  const result = await accepted.json();
  expect((await (await request.post(`/api/notes/generation/${jobId}`, { headers: source.headers, data: payload })).json()).noteId).toBe(result.noteId);
  const [task] = await sql`SELECT title, status, priority FROM officer_action_items WHERE source_note_id = ${result.noteId}`;
  expect(task).toMatchObject({ title: "Reviewed follow-up", status: "in_progress", priority: "high" });
  expect((await request.get(`/api/notes/${result.noteId}`, { headers: { Cookie: authCookieHeader(peer) } })).status()).toBe(404);
  const [original] = await sql`SELECT body FROM performance_notes WHERE id = ${source.noteId}`;
  expect(original.body).not.toContain("Human correction");
});

test("questions and stored conversation context stop replaying withdrawn evidence", async ({ request }) => {
  const { author, peer } = await createNotesFixture();
  const source = await indexed(request, authCookieHeader(author));
  const ask = async (threadId?: string) => request.post("/api/notes/generation", { headers: source.headers, data: { kind: "ask", locale: "en-US", question: "What should we do about Zenith?", threadId, requestId: nanoid() } });
  const first = await ask(); expect(first.status()).toBe(200);
  const job = await finish(request, source.headers, (await first.json()).jobId);
  expect(job.parts.every((part) => part.sections.every((section) => section.citations.length))).toBe(true);
  const next = await ask(job.threadId!); expect(next.status()).toBe(200);
  const continued = await finish(request, source.headers, (await next.json()).jobId);
  expect(continued.threadId).toBe(job.threadId);
  expect((await request.get(`/api/notes/conversations/${job.threadId}`, { headers: { Cookie: authCookieHeader(peer) } })).status()).toBe(404);
  const state = await (await request.get(source.url, { headers: source.headers })).json();
  await request.post(source.url, { headers: source.headers, data: { command: "deny_ai", expectedVersion: state.version, expectedContentVersion: state.contentVersion, requestId: nanoid() } });
  const replay = await (await request.get(`/api/notes/generation/${job.id}`, { headers: source.headers })).json();
  expect(replay).toMatchObject({ state: "invalidated", parts: [], evidence: [] });
  const thread = await (await request.get(`/api/notes/conversations/${job.threadId}`, { headers: source.headers })).json();
  expect(thread.turns.every((turn: GenerationResult) => turn.state === "invalidated" && !turn.parts.length)).toBe(true);
  expect((await ask(job.threadId!)).status()).not.toBe(200);
});

test("qualitative insights are saved canonically and remain private", async ({ request }) => {
  const { author, peer } = await createNotesFixture();
  const source = await indexed(request, authCookieHeader(author));
  const created = await request.post("/api/notes/generation", { headers: source.headers, data: { kind: "insight", locale: "en-US", resourceIds: [source.resourceId], requestId: nanoid() } });
  expect(created.status()).toBe(200);
  const job = await finish(request, source.headers, (await created.json()).jobId);
  const saved = await request.post(`/api/notes/generation/${job.id}`, { headers: source.headers, data: { requestId: nanoid(), expectedVersion: job.version, title: "Reviewed insight", body: generationBody(job.parts), actions: [] } });
  expect(saved.status()).toBe(200);
  const { noteId } = await saved.json();
  const insights = await (await request.get("/api/notes/insights", { headers: source.headers })).json();
  expect(insights.notes.map((note: { id: string }) => note.id)).toContain(noteId);
  expect((await (await request.get("/api/notes/insights", { headers: { Cookie: authCookieHeader(peer) } })).json()).notes).toEqual([]);
  const proof = await (await request.get(`/api/notes/${noteId}/evidence`, { headers: source.headers })).json();
  expect(proof.evidence.length).toBeGreaterThan(0);
});

test("localization covers all selected chunks and the studio exposes reviewed output", async ({ page }) => {
  const { author } = await createNotesFixture();
  const source = await indexed(page.request, authCookieHeader(author), `${"History context. ".repeat(1500)}Last original sentence.`);
  const created = await page.request.post("/api/notes/generation", { headers: source.headers, data: { kind: "localize", locale: "pt-BR", resourceIds: [source.resourceId], requestId: nanoid() } });
  expect(created.status()).toBe(200);
  const job = await finish(page.request, source.headers, (await created.json()).jobId);
  expect(job.cursor).toBe(job.total);
  expect(generationBody(job.parts)).toContain("Last original sentence.");
  expect(job.parts.flatMap((part) => part.actions)).toEqual([]);
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=studio");
  const panel = page.getByTestId("notes-studio");
  await panel.getByRole("button", { name: /^Localization/ }).click();
  await expect(panel.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(panel.locator("textarea").last()).toHaveValue(/Last original sentence\./);
});

test("generation APIs deny bootstrap sessions and cron without secret", async ({ request }) => {
  const sql = getE2eSql();
  const bootstrap = await createBrowserSession(sql);
  const cookie = `alliance_hq_session=${bootstrap.sessionId}`;
  expect((await request.post("/api/notes/generation", { headers: { Cookie: cookie }, data: { kind: "ask", locale: "en-US", question: "Zenith?", requestId: nanoid() } })).status()).toBe(403);
  expect((await request.get("/api/notes/generation", { headers: { Cookie: cookie } })).status()).toBe(403);
  expect((await request.get("/api/internal/notes/generate")).status()).toBe(403);
});
