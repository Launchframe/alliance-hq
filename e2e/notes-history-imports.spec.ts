import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authCookieHeader, getE2eSql } from "./fixtures/db";
import { playwrightAuthCookies } from "./fixtures/auth";
import { createNotesFixture } from "./fixtures/notes";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function staged(request: APIRequestContext, screenshots = false, invalid = false, screenshotBytes?: Buffer, audience?: "private" | "officers_read") {
  const fixture = await createNotesFixture("officer");
  const headers = { Cookie: authCookieHeader(fixture.author) };
  const bytes = screenshots ? screenshotBytes ?? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8n8AAAAASUVORK5CYII=", "base64") : Buffer.from(`Historical decision for Cookie. Player ${"1".repeat(14)} token=example-secret`);
  const file = { name: screenshots ? "capture.png" : "history.txt", contentType: screenshots ? "image/png" : invalid ? "application/json" : "text/plain", size: bytes.length, sha256: hash(bytes) };
  const input = { expectedScope: `${fixture.alliance.allianceId}:${fixture.author.hqUserId}`, requestId: nanoid(), title: "Reviewed history", kind: screenshots ? "screenshots" : invalid ? "discord_json" : "text", locale: "en-US", files: screenshots && !screenshotBytes ? [file, file] : [file], ...(audience ? { audience } : {}) };
  const created = await request.post("/api/notes/imports", { headers, data: input });
  expect(created.status(), await created.text()).toBe(200);
  const id = (await created.json()).importId as string;
  const detail = async () => (await (await request.get(`/api/notes/imports/${id}`, { headers })).json()).import;
  const initial = await detail();
  for (const asset of initial.files) {
    const target = await (await request.get(`/api/notes/imports/${id}/assets/${asset.id}`, { headers })).json();
    expect((await request.put(target.url, { headers: { ...headers, "Content-Type": file.contentType }, data: bytes })).status()).toBe(200);
    expect((await request.post(`/api/notes/imports/${id}/assets/${asset.id}`, { headers })).status()).toBe(200);
  }
  const command = async (command: string, expectedVersion?: number) => request.post(`/api/notes/imports/${id}`, { headers, data: { command, expectedVersion: expectedVersion ?? (await detail()).version, requestId: nanoid() } });
  expect((await command("finalize")).status()).toBe(200);
  return { ...fixture, id, input, bytes, headers, detail, command };
}

test("native screenshot OCR retains reviewable text without requiring parsed sender headers", async ({ request }) => {
  test.setTimeout(120_000);
  const lines = ["[TEST]Alpha", "Groups setup and ready.", "[TEST]Beta", "First message"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320"><rect width="1200" height="320" fill="white"/>${lines.map((line, index) => `<text x="32" y="${64 + index * 64}" font-family="Arial" font-size="32" fill="black">${line}</text>`).join("")}</svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const value = await staged(request, true, false, image);
  const processed = await request.post(`/api/notes/imports/${value.id}/process`, { headers: value.headers });
  expect(processed.status(), await processed.text()).toBe(200);
  const detail = await value.detail();
  expect(detail.state).toBe("review");
  expect(detail.messages.length).toBeGreaterThan(0);
  expect(detail.messages.map((message: { englishText: string }) => message.englishText).join("\n")).toMatch(/Groups setup and ready/);
  expect(detail.messages.every((message: { reviewed: boolean }) => !message.reviewed)).toBe(true);
  expect((await request.get(`/api/notes/imports/${value.id}`, { headers: { Cookie: authCookieHeader(value.peer) } })).status()).toBe(404);
  expect((await (await request.get("/api/notes?format=summary", { headers: value.headers })).json()).items).toHaveLength(0);
  expect((await (await request.get("/api/notes/tasks", { headers: value.headers })).json()).tasks).toHaveLength(0);
});

test("older imports remain discoverable with stable scoped cursors and browser navigation", async ({ page, request }) => {
  const { author, peer, alliance } = await createNotesFixture("officer");
  const sql = getE2eSql();
  const headers = { Cookie: authCookieHeader(author) };
  const prefix = nanoid();
  const seed = async (owner: string, id: string, title: string, archived = false, newer = false) => {
    const resourceId = nanoid();
    await sql`INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at, archived_at)
      VALUES (${resourceId}, ${alliance.allianceId}, 'source', ${id}, 'hq', ${owner}, now(), ${archived ? new Date() : null})`;
    await sql`INSERT INTO officer_chat_sessions (id, alliance_id, resource_id, title, created_by_hq_user_id, status)
      VALUES (${id}, ${alliance.allianceId}, ${resourceId}, ${title}, ${owner}, 'imported')`;
    await sql`INSERT INTO knowledge_history_imports (id, alliance_id, resource_id, kind, locale, source_hash, state, updated_at)
      VALUES (${id}, ${alliance.allianceId}, ${resourceId}, 'text', 'en-US', ${hash(Buffer.from(id))}, 'committed', ${newer ? "2026-09-16T12:00:00.123456Z" : "2026-09-15T12:00:00.123456Z"}::text::timestamptz)`;
  };
  for (let index = 0; index < 52; index++) await seed(author.hqUserId, `${prefix}_${String(index).padStart(3, "0")}`, `Archived source ${index}`);
  await seed(peer.hqUserId, nanoid(), "Private peer source");
  await seed(author.hqUserId, nanoid(), "Hidden archived source", true);
  const firstResponse = await request.get("/api/notes/imports", { headers });
  expect(firstResponse.status(), await firstResponse.text()).toBe(200);
  const first = await firstResponse.json();
  expect(first.imports).toHaveLength(50);
  expect(JSON.parse(first.nextCursor).updatedAt).toBe("2026-09-15T12:00:00.123456Z");
  expect(first.imports.every((item: { updatedAt: string }) => item.updatedAt === "2026-09-15T12:00:00.123456Z")).toBe(true);
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'knowledge_history_imports_page_idx'`;
  expect(index?.indexdef).toContain("(alliance_id, updated_at DESC, id DESC)");
  expect(JSON.stringify(first)).not.toMatch(/Private peer source|Hidden archived source/);
  expect(Object.keys(first.imports[0]).sort()).toEqual(["audience", "id", "kind", "owned", "state", "title", "updatedAt"]);
  await seed(author.hqUserId, nanoid(), "Newest source", false, true);
  const cursorUrl = `/api/notes/imports?${new URLSearchParams({ cursor: first.nextCursor })}`;
  const secondResponse = await request.get(cursorUrl, { headers });
  expect(secondResponse.status(), await secondResponse.text()).toBe(200);
  const second = await secondResponse.json();
  expect(second.imports.map((item: { id: string }) => item.id)).toEqual([`${prefix}_001`, `${prefix}_000`]);
  expect(second.nextCursor).toBeNull();
  expect(second.imports.every((item: { updatedAt: string }) => item.updatedAt === "2026-09-15T12:00:00.123456Z")).toBe(true);
  expect((await request.get(cursorUrl)).status()).toBe(401);
  expect((await request.get(cursorUrl, { headers: { Cookie: authCookieHeader(peer) } })).status()).toBe(403);
  const outsider = await createNotesFixture("officer");
  const otherHeaders = { Cookie: authCookieHeader(outsider.author) };
  expect((await request.get(cursorUrl, { headers: otherHeaders })).status()).toBe(403);
  expect((await (await request.get("/api/notes/imports", { headers: otherHeaders })).json()).imports).toHaveLength(0);
  for (const cursor of ["{}", "x".repeat(701)]) expect((await request.get(`/api/notes/imports?${new URLSearchParams({ cursor })}`, { headers })).status()).toBe(400);
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=imports");
  await expect.poll(() => page.url()).toContain("view=chatLogs");
  const next = page.getByRole("button", { name: "Next page", exact: true });
  const previous = page.getByRole("button", { name: "Previous page", exact: true });
  await expect(next).toBeEnabled();
  await expect(previous).toBeDisabled();
  const pagedList = (url: URL) => url.pathname === "/api/notes/imports" && url.searchParams.has("cursor");
  await page.route(pagedList, (route) => route.fulfill({ status: 503, json: { error: "Fixture pagination unavailable" } }));
  await next.click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture pagination unavailable" })).toBeInViewport();
  await expect(previous).toBeDisabled();
  await page.unroute(pagedList);
  await next.click();
  const oldest = page.getByRole("button", { name: /^Archived source 0\b/ });
  await expect(oldest).toBeVisible();
  await expect(next).toBeDisabled();
  await oldest.click();
  await expect(page.getByRole("heading", { name: "Archived source 0", exact: true })).toBeVisible();
  await page.locator("header").filter({ hasText: "HQ chat logs" }).getByRole("button", { name: "Chat logs", exact: true }).click();
  await expect(oldest).toBeVisible();
  await previous.click();
  await expect(page.getByRole("button", { name: /^Newest source/ })).toBeVisible();
  await next.click();
  await expect(oldest).toBeVisible();
  let release!: () => void;
  let captured!: () => void;
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => { delivered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { captured = resolve; });
  let intercepted = false;
  await page.route(pagedList, async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    captured();
    await held;
    try { await route.fulfill({ response }); } finally { delivered(); }
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await ready;
  await sql`UPDATE alliance_memberships SET status = 'removed' WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${author.hqUserId}`;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: /^Archived source/ })).toHaveCount(0);
  await expect(page.getByTestId("notes-workspace")).toHaveCount(0);
  release();
  await delivery;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("button", { name: /^Archived source/ })).toHaveCount(0);
});

for (const direction of ["next", "previous"] as const) test(`focus refreshes wait for pending ${direction} navigation and retain the resulting page`, async ({ page }) => {
  const { author, alliance } = await createNotesFixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  let holdNavigation = false, intercepted = false, reads = 0;
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { captured = resolve; });
  await page.route((url) => url.pathname === "/api/notes/imports", async (route) => {
    reads++;
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const second = cursor === "fixture-next";
    if (holdNavigation && !intercepted && cursor === (direction === "next" ? "fixture-next" : "fixture-previous")) {
      intercepted = true; captured(); await held;
    }
    await route.fulfill({ json: { scope: `${alliance.allianceId}:${author.hqUserId}`, imports: [{ id: second ? "second" : "first", title: second ? "Second page source" : "First page source", state: "committed", kind: "text", updatedAt: "2026-09-15T12:00:00.123456Z" }], nextCursor: second ? null : "fixture-next", previousCursor: second ? "fixture-previous" : null } });
  });
  try {
    await page.goto("/notes?view=chatLogs");
    const next = page.getByRole("button", { name: "Next page", exact: true });
    const previous = page.getByRole("button", { name: "Previous page", exact: true });
    await expect(next).toBeEnabled();
    if (direction === "previous") { await next.click(); await expect(previous).toBeEnabled(); }
    await expect.poll(() => reads).toBe(direction === "next" ? 1 : 3);
    const before = reads;
    holdNavigation = true;
    await (direction === "next" ? next : previous).click();
    await ready;
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    release();
    await expect(page.getByRole("button", { name: new RegExp(`^${direction === "next" ? "Second" : "First"} page source`) })).toBeVisible();
    await expect.poll(() => reads).toBe(before + 3);
    await expect(direction === "next" ? previous : next).toBeEnabled();
    await expect(direction === "next" ? next : previous).toBeDisabled();
  } finally { release(); }
});

test("import pager hides for single or empty pages but preserves visible list errors", async ({ page }) => {
  const { author, alliance } = await createNotesFixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  let mode: "single" | "empty" | "error" = "single";
  await page.route((url) => url.pathname === "/api/notes/imports", (route) => mode === "error"
    ? route.fulfill({ status: 503, json: { error: "Fixture list unavailable" } })
    : route.fulfill({ json: { scope: `${alliance.allianceId}:${author.hqUserId}`, imports: mode === "single" ? [{ id: "single", title: "Single page source", state: "committed", kind: "text", updatedAt: "2026-09-15T12:00:00.123456Z" }] : [], nextCursor: null, previousCursor: null } }));
  await page.goto("/notes?view=chatLogs");
  const next = page.getByRole("button", { name: "Next page", exact: true });
  const previous = page.getByRole("button", { name: "Previous page", exact: true });
  const source = page.getByRole("button", { name: /^Single page source/ });
  await expect(source).toBeVisible();
  await expect(next).toHaveCount(0); await expect(previous).toHaveCount(0);
  mode = "empty";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(source).toHaveCount(0);
  await expect(next).toHaveCount(0); await expect(previous).toHaveCount(0);
  mode = "error";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").filter({ hasText: "Fixture list unavailable" })).toBeInViewport();
  await expect(next).toBeDisabled(); await expect(previous).toBeDisabled();
  mode = "empty";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").filter({ hasText: "Fixture list unavailable" })).toHaveCount(0);
  await expect(next).toHaveCount(0); await expect(previous).toHaveCount(0);
});

test("browser paste review persists corrections and commits a private chat log", async ({ page }) => {
  const { author } = await createNotesFixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=chatLogs");
  await expect(page.getByText("Who can see this chat log?", { exact: true })).toBeVisible();
  await page.getByLabel("Source title", { exact: true }).fill("Historical diary");
  await page.getByLabel("Paste history", { exact: true }).fill("An earlier decision to verify coverage.");
  await page.getByRole("button", { name: "Upload and prepare review", exact: true }).click();
  const text = page.getByLabel("English text", { exact: true });
  await expect(text).toBeVisible();
  await text.fill("Corrected historical decision.");
  await page.getByRole("button", { name: "Reload review", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Discard your unsaved review changes?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Keep reviewing", exact: true }).click();
  await expect(text).toHaveValue("Corrected historical decision.");
  await expect(page.getByRole("button", { name: "Commit chat log", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save and mark this page reviewed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit chat log", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Commit chat log", exact: true }).click();
  await expect(page.getByText("Chat log saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("Corrected historical decision.", { exact: true })).toBeVisible();
  await page.locator("header").filter({ hasText: "HQ chat logs" }).getByRole("button", { name: "Chat logs", exact: true }).click();
  await page.getByRole("button", { name: "Historical diary" }).click();
  await expect(page.getByText("Corrected historical decision.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Corrected historical decision.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("English text", { exact: true })).toHaveCount(0);
});

test("paged JSON review requires every page and preserves the original dates", async ({ page }) => {
  const { author } = await createNotesFixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=chatLogs");
  await page.getByLabel("Source title", { exact: true }).fill("Paged history");
  await page.getByLabel("Import format", { exact: true }).selectOption("discord_json");
  const messages = Array.from({ length: 51 }, (_, index) => ({ id: String(index), author: null, timestamp: "2026-09-01T12:00:00Z", content: `Decision ${index}` }));
  await page.getByLabel("Paste history", { exact: true }).fill(JSON.stringify({ schemaVersion: 1, messages }));
  await page.getByRole("button", { name: "Upload and prepare review", exact: true }).click();
  await expect(page.getByLabel("English text", { exact: true })).toHaveCount(50);
  await page.getByRole("button", { name: "Save and mark this page reviewed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit chat log", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByLabel("English text", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Original date and time (UTC)", { exact: true })).toHaveValue("2026-09-01T12:00");
  await page.getByRole("button", { name: "Save and mark this page reviewed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit chat log", exact: true })).toBeEnabled();
});

test("attempt limits pause invalid exports and explicit retries preserve the sealed input", async ({ request }) => {
  const f = await staged(request, false, true);
  const sql = getE2eSql();
  for (let attempt = 0; attempt < 3; attempt++) {
    await sql`UPDATE knowledge_processing_jobs SET available_at = now() - interval '1 second' WHERE import_id = ${f.id}`;
    await request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  }
  expect(await f.detail()).toMatchObject({ state: "failed", total: 0, attempts: 3 });
  expect((await f.command("retry")).status()).toBe(200);
  expect(await f.detail()).toMatchObject({ state: "queued", attempts: 0 });
  expect((await f.detail()).files[0].sealed).toBe(true);
});

test("text intake keeps sealed originals private, requires review, and deduplicates retries", async ({ request }) => {
  const f = await staged(request);
  const peer = { Cookie: authCookieHeader(f.peer) };
  expect((await request.post("/api/notes/imports", { headers: f.headers, data: { ...f.input, requestId: nanoid(), expectedScope: "another:workspace" } })).status()).toBe(403);
  expect((await request.get("/api/notes/imports")).status()).toBe(401);
  expect((await request.get(`/api/notes/imports/${f.id}`, { headers: peer })).status()).toBe(404);
  expect((await request.post(`/api/notes/imports/${f.id}/process`, { headers: peer })).status()).toBe(404);
  expect((await request.get(`/api/officer-intel/sessions/${f.id}`, { headers: f.headers })).status()).toBe(404);
  expect((await request.get("/api/internal/notes/process")).status()).toBe(403);
  const duplicate = await request.post("/api/notes/imports", { headers: f.headers, data: { ...f.input, requestId: nanoid() } });
  expect((await duplicate.json()).importId).toBe(f.id);
  expect((await f.command("commit")).status()).toBe(409);
  expect((await request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers })).status()).toBe(200);
  const detail = await f.detail();
  expect(detail.state).toBe("review");
  expect(detail.messages).toHaveLength(1);
  expect(detail.messages[0]).toMatchObject({ sender: null, sentAt: null, reviewed: false });
  expect(JSON.stringify(detail).includes("1".repeat(14))).toBe(false);
  expect(JSON.stringify(detail)).not.toContain("example-secret");
  expect((await f.command("commit")).status()).toBe(400);
  const saved = await request.patch(`/api/notes/imports/${f.id}`, { headers: f.headers, data: { requestId: nanoid(), expectedVersion: detail.version, edits: detail.messages.map((row: { id: string }) => ({ id: row.id, body: "Reviewed decision", sender: "Unverified Cookie", sentAt: "2026-09-01T12:00:00Z", included: true })) } });
  expect(saved.status()).toBe(200);
  expect((await f.command("commit", detail.version)).status()).toBe(409);
  expect((await f.command("commit")).status()).toBe(200);
  expect((await f.command("commit")).status()).toBe(200);
  const sql = getE2eSql();
  const [source] = await sql`SELECT knowledge_ai_allowed, intake_ai_allowed FROM knowledge_resources WHERE id = ${`source:${f.id}`}`;
  expect(source).toMatchObject({ knowledge_ai_allowed: false, intake_ai_allowed: false });
  const [tasks] = await sql`SELECT count(*)::integer AS count FROM officer_action_items WHERE session_id = ${f.id}`;
  expect(tasks.count).toBe(0);
  const [asset] = await sql`SELECT staging_key, sealed_key, sha256 FROM knowledge_history_assets WHERE import_id = ${f.id}`;
  expect(asset.sealed_key).not.toBe(asset.staging_key);
  expect(asset.sha256).toBe(hash(f.bytes));
  const legacy = await (await request.get(`/api/officer-intel/sessions/${f.id}`, { headers: f.headers })).json();
  expect(legacy.messages[0].originalText).toBe("Reviewed decision");
  const again = await request.post("/api/notes/imports", { headers: f.headers, data: { ...f.input, requestId: nanoid() } });
  expect(again.status(), await again.text()).toBe(200);
  expect((await again.json()).importId).not.toBe(f.id);
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect(bootstrap.status()).toBeGreaterThanOrEqual(300);
  expect(bootstrap.status()).toBeLessThan(400);
  const setCookie = bootstrap.headers()["set-cookie"] ?? "";
  const bootstrapSession = /alliance_hq_session=([^;]+)/.exec(Array.isArray(setCookie) ? setCookie.join(";") : setCookie)?.[1];
  expect(bootstrapSession).toBeTruthy();
  const bootstrapCookie = `alliance_hq_session=${bootstrapSession}`;
  expect((await request.get("/api/notes/imports", { headers: { Cookie: bootstrapCookie } })).status()).toBe(403);
  expect((await request.post("/api/notes/imports", { headers: { Cookie: bootstrapCookie }, data: f.input })).status()).toBe(403);
  expect((await request.get(`/api/notes/imports/${f.id}`, { headers: { Cookie: bootstrapCookie } })).status()).toBe(403);
  expect((await request.post(`/api/notes/imports/${f.id}/process`, { headers: { Cookie: bootstrapCookie } })).status()).toBe(403);
});

test("leased parsing checkpoints files, cancels stale work, and resumes without duplicates", async ({ request }) => {
  const f = await staged(request, true);
  const sql = getE2eSql();
  const running = request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  await expect.poll(async () => (await sql`SELECT state FROM knowledge_processing_jobs WHERE import_id = ${f.id}`)[0].state).toBe("running");
  expect((await f.command("cancel")).status()).toBe(200);
  await running;
  expect((await f.detail()).total).toBe(0);
  expect((await f.command("retry")).status()).toBe(200);
  await request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  expect(await f.detail()).toMatchObject({ cursor: 1, total: 1, state: "queued" });
  const expired = request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  await expect.poll(async () => (await sql`SELECT state FROM knowledge_processing_jobs WHERE import_id = ${f.id}`)[0].state).toBe("running");
  await sql`UPDATE knowledge_processing_jobs SET lease_expires_at = now() - interval '1 second' WHERE import_id = ${f.id}`;
  const replacement = request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  await Promise.all([expired, replacement]);
  expect(await f.detail()).toMatchObject({ cursor: 2, total: 2, state: "review" });
});

test("revoking membership prevents in-flight output publication", async ({ request }) => {
  const f = await staged(request);
  const sql = getE2eSql();
  const running = request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  await expect.poll(async () => (await sql`SELECT state FROM knowledge_processing_jobs WHERE import_id = ${f.id}`)[0].state).toBe("running");
  await sql`UPDATE alliance_memberships SET status = 'removed' WHERE alliance_id = ${f.alliance.allianceId} AND hq_user_id = ${f.author.hqUserId}`;
  await running;
  const [row] = await sql`SELECT state FROM knowledge_processing_jobs WHERE import_id = ${f.id}`;
  expect(row.state).toBe("cancelled");
  const [messages] = await sql`SELECT count(*)::integer AS count FROM officer_chat_messages WHERE session_id = ${f.id}`;
  expect(messages.count).toBe(0);
});

test("officers-read chat logs share committed transcripts without granting edit access", async ({ request }) => {
  const f = await staged(request, false, false, undefined, "officers_read");
  const same = await request.post("/api/notes/imports", { headers: f.headers, data: { ...f.input, requestId: nanoid() } });
  expect((await same.json()).importId).toBe(f.id);
  const otherAudience = await request.post("/api/notes/imports", { headers: f.headers, data: { ...f.input, requestId: nanoid(), audience: "private" } });
  expect((await otherAudience.json()).importId).not.toBe(f.id);
  await request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  const detail = await f.detail();
  expect(detail).toMatchObject({ state: "review", audience: "officers_read", owned: true, editable: true });
  const peerHeaders = { Cookie: authCookieHeader(f.peer) };
  expect((await request.get(`/api/notes/imports/${f.id}`, { headers: peerHeaders })).status()).toBe(404);
  const saved = await request.patch(`/api/notes/imports/${f.id}`, { headers: f.headers, data: { requestId: nanoid(), expectedVersion: detail.version, edits: detail.messages.map((row: { id: string }) => ({ id: row.id, sender: null, sentAt: null, englishText: "Reviewed decision", included: true })) } });
  expect(saved.status(), await saved.text()).toBe(200);
  expect((await f.command("commit")).status()).toBe(200);
  expect((await f.command("commit")).status()).toBe(200);
  const peerDetail = await request.get(`/api/notes/imports/${f.id}`, { headers: peerHeaders });
  expect(peerDetail.status(), await peerDetail.text()).toBe(200);
  const shared = (await peerDetail.json()).import;
  expect(shared).toMatchObject({ audience: "officers_read", owned: false, editable: false, state: "committed" });
  expect(shared.messages[0].englishText).toBe("Reviewed decision");
  const list = await (await request.get("/api/notes/imports", { headers: peerHeaders })).json();
  const sharedRow = list.imports.find((item: { id: string }) => item.id === f.id);
  expect(sharedRow).toMatchObject({ owned: false, audience: "officers_read" });
  const patch = await request.patch(`/api/notes/imports/${f.id}`, { headers: peerHeaders, data: { requestId: nanoid(), expectedVersion: shared.version, edits: [{ id: shared.messages[0].id, sender: null, sentAt: null, englishText: "Tampered", included: true }] } });
  const command = await request.post(`/api/notes/imports/${f.id}`, { headers: peerHeaders, data: { command: "retry", expectedVersion: shared.version, requestId: nanoid() } });
  const process = await request.post(`/api/notes/imports/${f.id}/process`, { headers: peerHeaders });
  expect([patch.status(), command.status(), process.status()]).toEqual([404, 404, 404]);
  const sql = getE2eSql();
  await sql`INSERT INTO knowledge_resource_grants (id, resource_id, alliance_id, subject_kind, subject_id, role, created_by_hq_user_id)
    VALUES (${nanoid()}, ${`source:${f.id}`}, ${f.alliance.allianceId}, 'user', ${f.peer.hqUserId}, 'edit', ${f.author.hqUserId})
    ON CONFLICT DO NOTHING`;
  const grantedPatch = await request.patch(`/api/notes/imports/${f.id}`, { headers: peerHeaders, data: { requestId: nanoid(), expectedVersion: shared.version, edits: [{ id: shared.messages[0].id, sender: null, sentAt: null, englishText: "Tampered", included: true }] } });
  const grantedCommand = await request.post(`/api/notes/imports/${f.id}`, { headers: peerHeaders, data: { command: "cancel", expectedVersion: shared.version, requestId: nanoid() } });
  const grantedRetry = await request.post(`/api/notes/imports/${f.id}`, { headers: peerHeaders, data: { command: "retry", expectedVersion: shared.version, requestId: nanoid() } });
  expect([grantedPatch.status(), grantedCommand.status(), grantedRetry.status()]).toEqual([404, 404, 404]);
  expect((await request.get(`/api/notes/imports/${f.id}`, { headers: peerHeaders })).status()).toBe(200);
  await sql`UPDATE alliance_memberships SET status = 'removed' WHERE alliance_id = ${f.alliance.allianceId} AND hq_user_id = ${f.peer.hqUserId}`;
  expect((await request.get(`/api/notes/imports/${f.id}`, { headers: peerHeaders })).status()).toBe(403);
  expect((await request.get("/api/notes/imports", { headers: peerHeaders })).status()).toBe(403);
});

test("chat logs canonicalize legacy deep links and Officer Intelligence session routes", async ({ page, request }) => {
  const f = await staged(request);
  await page.context().addCookies(playwrightAuthCookies(f.author));
  await page.goto(`/officer-intel/sessions/${f.id}`);
  await expect.poll(() => page.url()).toContain("view=chatLogs");
  expect(page.url()).toContain(`chatLog=${f.id}`);
  await expect(page.getByRole("heading", { name: "Reviewed history" })).toBeVisible();
  await page.goto(`/notes?view=imports&import=${f.id}`);
  await expect.poll(() => page.url()).toContain("view=chatLogs");
  expect(page.url()).toContain(`chatLog=${f.id}`);
  expect(page.url()).not.toContain("view=imports");
  await page.goto("/officer-intel");
  await page.getByRole("link", { name: "Chat logs", exact: true }).click();
  await expect.poll(() => page.url()).toContain("view=chatLogs");
});

test("standalone media review commits a media-only chat log and hides storage keys", async ({ request }) => {
  const f = await staged(request);
  await request.post(`/api/notes/imports/${f.id}/process`, { headers: f.headers });
  const sql = getE2eSql();
  const mediaId = nanoid();
  const storageKey = `notes-history/${f.id}/sealed/media`;
  await sql`INSERT INTO officer_chat_message_media (id, session_id, alliance_id, kind, storage_key, content_type, sha256, sequence_order)
    VALUES (${mediaId}, ${f.id}, ${f.alliance.allianceId}, 'fullscreen', ${storageKey}, 'image/png', ${hash(f.bytes)}, 0)`;
  const detail = await f.detail();
  expect(detail.sessionMedia).toHaveLength(1);
  expect(detail.sessionMedia[0]).toMatchObject({ kind: "fullscreen", reviewed: false });
  expect(detail.sessionMedia[0].fullHref).toBe(`/api/notes/imports/${f.id}/media/${mediaId}`);
  expect(JSON.stringify(detail)).not.toContain("storage_key");
  const excluded = await request.patch(`/api/notes/imports/${f.id}`, { headers: f.headers, data: { requestId: nanoid(), expectedVersion: detail.version, edits: detail.messages.map((row: { id: string }) => ({ id: row.id, sender: null, sentAt: null, included: false })) } });
  expect(excluded.status(), await excluded.text()).toBe(200);
  expect((await f.command("commit")).status()).toBe(400);
  const reviewed = await request.patch(`/api/notes/imports/${f.id}`, { headers: f.headers, data: { requestId: nanoid(), expectedVersion: (await f.detail()).version, mediaReviews: [{ id: mediaId, reviewed: true }] } });
  expect(reviewed.status(), await reviewed.text()).toBe(200);
  expect((await f.command("commit")).status()).toBe(200);
});

test("reply links are confined to the same chat log", async ({ request }) => {
  const first = await staged(request);
  const second = await staged(request);
  await request.post(`/api/notes/imports/${first.id}/process`, { headers: first.headers });
  await request.post(`/api/notes/imports/${second.id}/process`, { headers: second.headers });
  const own = await first.detail();
  const other = await second.detail();
  const rejected = await request.patch(`/api/notes/imports/${first.id}`, { headers: first.headers, data: { requestId: nanoid(), expectedVersion: own.version, edits: [{ id: own.messages[0].id, sender: null, sentAt: null, included: true, replyToMessageId: other.messages[0].id }] } });
  expect(rejected.status(), await rejected.text()).toBe(400);
  const sql = getE2eSql();
  await expect(sql`UPDATE officer_chat_messages SET reply_to_message_id = ${other.messages[0].id} WHERE id = ${own.messages[0].id}`).rejects.toThrow();
});

test("direct officer chat sessions bridge into chat logs with authorized evidence", async ({ page, request }) => {
  const { author } = await createNotesFixture("officer");
  const headers = { Cookie: authCookieHeader(author) };
  const created = await request.post("/api/officer-intel/sessions", { headers, data: { title: "Legacy capture" } });
  expect(created.status(), await created.text()).toBe(200);
  const sessionId = (await created.json()).sessionId as string;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8n8AAAAASUVORK5CYII=", "base64");
  const imported = await request.post(`/api/officer-intel/sessions/${sessionId}/import`, {
    headers,
    multipart: {
      payload: JSON.stringify({ messages: [{ senderName: "Cookie", originalText: "Legacy hello", sequenceOrder: 0, sourceImageIndex: 0 }] }),
      images: { name: "capture.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const detail = await request.get(`/api/notes/imports/${sessionId}`, { headers });
  expect(detail.status(), await detail.text()).toBe(200);
  const body = (await detail.json()).import;
  expect(body).toMatchObject({ state: "committed", audience: "private", kind: "screenshots", owned: true });
  expect(body.messages.map((row: { englishText: string }) => row.englishText)).toContain("Legacy hello");
  expect(body.evidence).toHaveLength(1);
  expect(body.evidence[0].href).toBe(`/api/officer-intel/sessions/${sessionId}/images/${body.evidence[0].id}`);
  expect(JSON.stringify(body)).not.toContain("storage_key");
  expect((await request.get(body.evidence[0].href, { headers })).status()).toBe(200);
  const draft = await request.post("/api/officer-intel/sessions", { headers, data: { title: "Unfinished capture" } });
  expect(draft.status(), await draft.text()).toBe(200);
  const draftId = (await draft.json()).sessionId as string;
  const draftDetail = await request.get(`/api/notes/imports/${draftId}`, { headers });
  expect(draftDetail.status(), await draftDetail.text()).toBe(404);
  const list = await request.get("/api/notes/imports", { headers });
  expect(list.status(), await list.text()).toBe(200);
  const listIds = ((await list.json()).imports as { id: string }[]).map((row) => row.id);
  expect(listIds).toContain(sessionId);
  expect(listIds).not.toContain(draftId);
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto(`/officer-intel/sessions/${sessionId}`);
  await expect.poll(() => page.url()).toContain("view=chatLogs");
  expect(page.url()).toContain(`chatLog=${sessionId}`);
  await expect(page.getByText("Legacy hello", { exact: true })).toBeVisible();
});

const seedVideoChatLog = async (fixture: Awaited<ReturnType<typeof createNotesFixture>>, id: string, state: "review" | "committed", audience: "private" | "officers_read", count: number) => {
  const sql = getE2eSql();
  const resourceId = nanoid();
  await sql`INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at)
    VALUES (${resourceId}, ${fixture.alliance.allianceId}, 'source', ${id}, 'hq', ${fixture.author.hqUserId}, now())`;
  await sql`INSERT INTO officer_chat_sessions (id, alliance_id, resource_id, title, created_by_hq_user_id, status)
    VALUES (${id}, ${fixture.alliance.allianceId}, ${resourceId}, ${"Video chat log"}, ${fixture.author.hqUserId}, 'imported')`;
  await sql`INSERT INTO knowledge_history_imports (id, alliance_id, resource_id, kind, locale, source_hash, state, audience)
    VALUES (${id}, ${fixture.alliance.allianceId}, ${resourceId}, 'video', 'en-US', ${hash(Buffer.from(id))}, ${state}, ${audience})`;
  const firstId = `${id}-msg-0`;
  for (let index = 0; index < count; index++) {
    const original = index === 0 ? "Mensagem zero" : `Chat message ${index}`;
    const isReply = index === 1;
    const coordinates = index === 2 ? { server: 123, x: 450, y: 320, label: "Hall" } : null;
    await sql`INSERT INTO officer_chat_messages (id, session_id, alliance_id, sender_name, original_text, locale_text, locale_code, is_reply, reply_to_name, reply_to_message_id, coordinates, sequence_order, source_locator, history_included, history_reviewed)
      VALUES (${`${id}-msg-${index}`}, ${id}, ${fixture.alliance.allianceId}, ${`Alpha${index}`}, ${original}, ${`Chat message ${index}`}, 'en-US', ${isReply}, ${isReply ? "Alpha0" : null}, ${isReply ? firstId : null}, ${coordinates === null ? null : sql.json(coordinates)}, ${index}, ${`video:${index}`}, true, ${state === "committed"})`;
  }
  const messageMediaId = `${id}-media-message`;
  const sessionMediaId = `${id}-media-session`;
  if (count > 0) {
    await sql`INSERT INTO officer_chat_message_media (id, session_id, alliance_id, message_id, kind, storage_key, thumbnail_storage_key, content_type, sha256, sequence_order, reviewed)
      VALUES (${messageMediaId}, ${id}, ${fixture.alliance.allianceId}, ${firstId}, 'embedded', ${`notes-history/${id}/media/${messageMediaId}.png`}, ${`notes-history/${id}/media/${messageMediaId}.webp`}, 'image/png', ${hash(Buffer.from(messageMediaId))}, 0, ${state === "committed"})`;
    await sql`INSERT INTO officer_chat_message_media (id, session_id, alliance_id, message_id, kind, storage_key, thumbnail_storage_key, content_type, sha256, sequence_order, reviewed)
      VALUES (${sessionMediaId}, ${id}, ${fixture.alliance.allianceId}, ${null}, 'fullscreen', ${`notes-history/${id}/media/${sessionMediaId}.png`}, ${`notes-history/${id}/media/${sessionMediaId}.webp`}, 'image/png', ${hash(Buffer.from(sessionMediaId))}, 1, ${state === "committed"})`;
  }
  return { resourceId, firstId, messageMediaId, sessionMediaId };
};

test("browser chat video source shows disclosures and uploads with the import descriptor", async ({ page }) => {
  const { author } = await createNotesFixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  let initBody: Record<string, unknown> | null = null;
  let marker: URLSearchParams | null = null;
  let processCalls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/tools/video-upload**", async (route, req) => {
    const url = new URL(req.url());
    if (req.method() === "GET" && !url.searchParams.has("knowledgeImportId")) {
      return route.fulfill({ json: { jobs: [], scoreTargets: [], upload: { mode: "direct", maxUploadBytes: 96 * 1024 * 1024, multipartThresholdBytes: 8 * 1024 * 1024, multipartPartBytes: 8 * 1024 * 1024, legacyDirectPostMaxBytes: 64 * 1024 * 1024 } } });
    }
    marker = url.searchParams;
    await held;
    return route.fulfill({ json: { ok: true, jobId: "job-e2e-1", status: "pending_approval", message: "ok" } });
  });
  await page.route("**/api/notes/imports", async (route, req) => {
    if (req.method() !== "POST") return route.continue();
    initBody = req.postDataJSON() as Record<string, unknown>;
    const response = await route.fetch();
    return route.fulfill({ response });
  });
  await page.route("**/api/notes/imports/*/process", (route) => { processCalls++; return route.fulfill({ status: 500, json: { error: "should not process" } }); });
  const importsLoaded = page.waitForResponse((res) => res.url().includes("/api/notes/imports"));
  await page.goto("/notes?view=chatLogs");
  await importsLoaded;
  await page.getByLabel("Import format", { exact: true }).selectOption("video");
  await expect(page.getByLabel("Import format", { exact: true })).toHaveValue("video");
  await expect(page.getByText("Chat videos can be up to 2 minutes and 96 MB.", { exact: true })).toBeVisible();
  await expect(page.getByText(/HQ sends selected video frames to OpenAI/, { exact: false })).toBeVisible();
  await expect(page.getByText(/highest quality available in your recording/, { exact: false })).toBeVisible();
  await expect(page.getByText(/deleted seven days after you commit/, { exact: false })).toBeVisible();
  await expect(page.getByLabel("Paste history", { exact: true })).toHaveCount(0);
  await page.getByLabel("Source title", { exact: true }).fill("Recorded alliance chat");
  const video = Buffer.alloc(3 * 1024 * 1024, 1);
  await page.getByLabel("Upload chat video", { exact: true }).setInputFiles({ name: "chat.mp4", mimeType: "video/mp4", buffer: video });
  await page.getByRole("button", { name: "Upload chat video", exact: true }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Recorded alliance chat", exact: true })).toBeVisible();
  expect(initBody).not.toBeNull();
  expect(initBody!.kind).toBe("video");
  expect(initBody!.audience).toBe("private");
  const files = initBody!.files as Array<{ name: string; size: number; contentType: string; sha256: string }>;
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ name: "chat.mp4", size: video.length, contentType: "video/mp4" });
  expect(files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(marker).not.toBeNull();
  expect(marker!.get("scoreTarget")).toBe("officer-chat-video");
  const detail = await page.request.get("/api/notes/imports", { headers: { Cookie: authCookieHeader(author) } });
  const importId = (await detail.json()).imports[0].id as string;
  expect(marker!.get("knowledgeImportId")).toBe(importId);
  expect(page.url()).toContain(`chatLog=${importId}`);
  await page.waitForTimeout(4_500);
  expect(processCalls).toBe(0);
});

test("committed video transcript pages media through the lightbox and keeps replies and coordinates", async ({ page }) => {
  const fixture = await createNotesFixture("officer");
  const id = nanoid();
  const seeded = await seedVideoChatLog(fixture, id, "committed", "private", 55);
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 32, g: 64, b: 96 } } }).png().toBuffer();
  await page.route("**/api/notes/imports/*/media/*", (route) => route.fulfill({ contentType: "image/png", body: png }));
  await page.context().addCookies(playwrightAuthCookies(fixture.author));
  await page.goto(`/notes?view=chatLogs&chatLog=${id}`);
  await expect(page.getByRole("heading", { name: "Video chat log", exact: true })).toBeVisible();
  await expect(page.getByText("Chat message 0", { exact: true })).toBeVisible();
  await expect(page.getByText("Mensagem zero", { exact: true })).toBeHidden();
  await page.getByText("Show original", { exact: true }).first().click();
  await expect(page.getByText("Mensagem zero", { exact: true })).toBeVisible();
  await expect(page.getByText("Replying to Alpha0", { exact: true })).toBeVisible();
  await expect(page.getByText(/S123 450:320 Hall/, { exact: false })).toBeVisible();
  const thumbnails = page.getByRole("button", { name: /Image extracted from video/ });
  await expect(thumbnails).toHaveCount(2);
  await thumbnails.first().click();
  await expect(page.locator(".yarl__container")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".yarl__container")).toHaveCount(0);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Chat message 50", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  expect(seeded.messageMediaId).toBeTruthy();
});

test("video review commit schedules source cleanup and completes the linked job", async ({ request }) => {
  const fixture = await createNotesFixture("officer");
  const id = nanoid();
  await seedVideoChatLog(fixture, id, "review", "officers_read", 1);
  const sql = getE2eSql();
  const jobId = nanoid(16);
  await sql`INSERT INTO video_jobs (id, session_id, hq_user_id, status, file_name, score_target, storage_key, alliance_id, knowledge_import_id, enqueued_by_hq_user_id, ingest_method)
    VALUES (${jobId}, ${fixture.author.sessionId}, ${fixture.author.hqUserId}, 'review', 'chat.mp4', 'officer-chat-video', ${`notes-history/${id}/staging/video`}, ${fixture.alliance.allianceId}, ${id}, ${fixture.author.hqUserId}, 'video')`;
  await sql`UPDATE knowledge_history_imports SET source_video_job_id = ${jobId} WHERE id = ${id}`;
  await sql`UPDATE officer_chat_messages SET history_reviewed = true WHERE session_id = ${id}`;
  await sql`UPDATE officer_chat_message_media SET reviewed = true WHERE session_id = ${id}`;
  const headers = { Cookie: authCookieHeader(fixture.author) };
  const detail = async () => (await (await request.get(`/api/notes/imports/${id}`, { headers })).json()).import;
  const version = (await detail()).version;
  const committed = await request.post(`/api/notes/imports/${id}`, { headers, data: { command: "commit", expectedVersion: version, requestId: nanoid() } });
  expect(committed.status(), await committed.text()).toBe(200);
  const [row] = await sql`SELECT source_delete_after FROM knowledge_history_imports WHERE id = ${id}`;
  const deleteAfter = new Date(row.source_delete_after).getTime();
  expect(Math.abs(deleteAfter - (Date.now() + 7 * 24 * 60 * 60 * 1000))).toBeLessThan(60_000);
  const [job] = await sql`SELECT status FROM video_jobs WHERE id = ${jobId}`;
  expect(job.status).toBe("complete");
  const peerHeaders = { Cookie: authCookieHeader(fixture.peer) };
  const peerDetail = await request.get(`/api/notes/imports/${id}`, { headers: peerHeaders });
  expect(peerDetail.status(), await peerDetail.text()).toBe(200);
  expect((await peerDetail.json()).import.owned).toBe(false);
  const peerCommit = await request.post(`/api/notes/imports/${id}`, { headers: peerHeaders, data: { command: "commit", expectedVersion: version, requestId: nanoid() } });
  expect(peerCommit.status()).toBeGreaterThanOrEqual(400);
  expect((await request.get("/api/internal/notes/cleanup")).status()).toBe(403);
});

test("pending_approval video import polls the detail endpoint without posting process", async ({ page }) => {
  const fixture = await createNotesFixture("officer");
  const id = nanoid();
  await seedVideoChatLog(fixture, id, "review", "private", 0);
  const sql = getE2eSql();
  await sql`UPDATE knowledge_history_imports SET state = 'pending_approval' WHERE id = ${id}`;
  let processCalls = 0;
  let detailLoads = 0;
  await page.route(`**/api/notes/imports/${id}**`, (route) => { detailLoads++; return route.continue(); });
  await page.route("**/api/notes/imports/*/process", (route) => { processCalls++; return route.fulfill({ status: 500, json: { error: "should not process" } }); });
  await page.context().addCookies(playwrightAuthCookies(fixture.author));
  await page.goto(`/notes?view=chatLogs&chatLog=${id}`);
  await expect(page.getByRole("heading", { name: "Video chat log", exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for processor approval", { exact: true })).toBeVisible();
  await page.waitForTimeout(4_500);
  expect(detailLoads).toBeGreaterThanOrEqual(2);
  expect(processCalls).toBe(0);
});

test("navigating away before the chat video upload starts aborts without uploading or opening", async ({ page }) => {
  const fixture = await createNotesFixture("officer");
  const otherId = nanoid();
  await seedVideoChatLog(fixture, otherId, "committed", "private", 1);
  await page.context().addCookies(playwrightAuthCookies(fixture.author));
  let aborted = false;
  let initSeen = false;
  let uploadPosts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/tools/video-upload**", async (route, req) => {
    const url = new URL(req.url());
    if (req.method() === "GET" && !url.searchParams.has("knowledgeImportId")) {
      return route.fulfill({ json: { jobs: [], scoreTargets: [], upload: { mode: "direct", maxUploadBytes: 96 * 1024 * 1024, multipartThresholdBytes: 8 * 1024 * 1024, multipartPartBytes: 8 * 1024 * 1024, legacyDirectPostMaxBytes: 64 * 1024 * 1024 } } });
    }
    uploadPosts++;
    return route.fulfill({ json: { ok: true, jobId: "job-e2e-abort-init", status: "pending_approval", message: "ok" } });
  });
  await page.route("**/api/notes/imports", async (route, req) => {
    if (req.method() !== "POST") return route.continue();
    initSeen = true;
    await held;
    try { return await route.continue(); } catch { return route.abort(); }
  });
  page.on("requestfailed", (req) => { if (req.method() === "POST" && req.url().includes("/api/notes/imports")) aborted = true; });
  const importsLoaded = page.waitForResponse((res) => res.url().includes("/api/notes/imports"));
  await page.goto("/notes?view=chatLogs");
  await importsLoaded;
  await page.getByLabel("Import format", { exact: true }).selectOption("video");
  await page.getByLabel("Source title", { exact: true }).fill("Abandoned chat video");
  const video = Buffer.alloc(2 * 1024 * 1024, 1);
  await page.getByLabel("Upload chat video", { exact: true }).setInputFiles({ name: "abandoned.mp4", mimeType: "video/mp4", buffer: video });
  await page.getByRole("button", { name: "Upload chat video", exact: true }).click();
  await expect.poll(() => initSeen).toBe(true);
  await page.getByRole("button", { name: /^Video chat log/ }).click();
  await expect.poll(() => aborted).toBe(true);
  release();
  await expect(page.getByRole("heading", { name: "Video chat log", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  expect(uploadPosts).toBe(0);
  expect(page.url()).toContain(`chatLog=${otherId}`);
  expect(page.url()).not.toContain("view=imports");
});

test("discarding a held chat video upload aborts the request without opening the import", async ({ page }) => {
  const fixture = await createNotesFixture("officer");
  const otherId = nanoid();
  await seedVideoChatLog(fixture, otherId, "committed", "private", 1);
  await page.context().addCookies(playwrightAuthCookies(fixture.author));
  let aborted = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/tools/video-upload**", async (route, req) => {
    const url = new URL(req.url());
    if (req.method() === "GET" && !url.searchParams.has("knowledgeImportId")) {
      return route.fulfill({ json: { jobs: [], scoreTargets: [], upload: { mode: "direct", maxUploadBytes: 96 * 1024 * 1024, multipartThresholdBytes: 8 * 1024 * 1024, multipartPartBytes: 8 * 1024 * 1024, legacyDirectPostMaxBytes: 64 * 1024 * 1024 } } });
    }
    await held;
    return route.fulfill({ json: { ok: true, jobId: "job-e2e-abort", status: "pending_approval", message: "ok" } });
  });
  page.on("requestfailed", (req) => { if (req.method() === "POST" && req.url().includes("/api/tools/video-upload")) aborted = true; });
  const importsLoaded = page.waitForResponse((res) => res.url().includes("/api/notes/imports"));
  await page.goto("/notes?view=chatLogs");
  await importsLoaded;
  await page.getByLabel("Import format", { exact: true }).selectOption("video");
  await page.getByLabel("Source title", { exact: true }).fill("Abandoned chat video");
  const video = Buffer.alloc(2 * 1024 * 1024, 1);
  await page.getByLabel("Upload chat video", { exact: true }).setInputFiles({ name: "abandoned.mp4", mimeType: "video/mp4", buffer: video });
  await page.getByRole("button", { name: "Upload chat video", exact: true }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.getByRole("button", { name: /^Video chat log/ }).click();
  await expect.poll(() => aborted).toBe(true);
  release();
  await expect(page.getByRole("heading", { name: "Video chat log", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  expect(page.url()).toContain(`chatLog=${otherId}`);
  expect(page.url()).not.toContain("view=imports");
});

test("cleanup deletes only the due committed video source and enforces import constraints", async ({ request }) => {
  const fixture = await createNotesFixture("officer");
  const id = nanoid();
  const seeded = await seedVideoChatLog(fixture, id, "committed", "officers_read", 2);
  const sql = getE2eSql();
  await sql`INSERT INTO knowledge_resource_grants (id, resource_id, alliance_id, subject_kind, subject_id, role, created_by_hq_user_id)
    VALUES (${nanoid()}, ${seeded.resourceId}, ${fixture.alliance.allianceId}, 'officers', ${fixture.alliance.allianceId}, 'read', ${fixture.author.hqUserId})
    ON CONFLICT DO NOTHING`;
  const uploads = path.join(process.cwd(), ".data", "uploads");
  const sourceBytes = Buffer.from("e2e chat video source bytes");
  const mediaPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
  const mediaWebp = await sharp(mediaPng).webp().toBuffer();
  const sourceKey = `notes-history/${id}/sealed/source.mp4`;
  const messageMediaKey = `notes-history/${id}/media/${seeded.messageMediaId}.png`;
  const messageThumbKey = `notes-history/${id}/media/${seeded.messageMediaId}.webp`;
  const sessionMediaKey = `notes-history/${id}/media/${seeded.sessionMediaId}.png`;
  for (const [key, bytes] of [[sourceKey, sourceBytes], [messageMediaKey, mediaPng], [messageThumbKey, mediaWebp], [sessionMediaKey, mediaPng]] as const) {
    const target = path.join(uploads, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  const assetId = nanoid();
  await sql`INSERT INTO knowledge_history_assets (id, import_id, alliance_id, name, content_type, size, sha256, position, staging_key, sealed_key, sealed_at)
    VALUES (${assetId}, ${id}, ${fixture.alliance.allianceId}, 'chat.mp4', 'video/mp4', ${sourceBytes.length}, ${hash(sourceBytes)}, 0, ${`notes-history/${id}/staging/source`}, ${sourceKey}, now())`;
  await sql`UPDATE knowledge_history_imports SET source_delete_after = now() - interval '1 hour' WHERE id = ${id}`;

  await expect(sql`UPDATE knowledge_history_imports SET kind = 'bogus' WHERE id = ${id}`).rejects.toThrow();
  await expect(sql`UPDATE knowledge_history_imports SET state = 'bogus' WHERE id = ${id}`).rejects.toThrow();
  await expect(sql`UPDATE knowledge_history_assets SET size = 536870913 WHERE id = ${assetId}`).rejects.toThrow();
  await expect(sql`UPDATE knowledge_history_imports SET format_version = 2 WHERE id = ${id}`).rejects.toThrow();
  await expect(sql`INSERT INTO knowledge_history_assets (id, import_id, alliance_id, name, content_type, size, sha256, position, staging_key)
    VALUES (${nanoid()}, ${id}, ${fixture.alliance.allianceId}, 'overflow.mp4', 'video/mp4', 8, ${hash(sourceBytes)}, 12, 'staging/overflow')`).rejects.toThrow();
  await expect(sql`UPDATE knowledge_history_assets SET sealed_key = null WHERE id = ${assetId}`).rejects.toThrow();
  await sql`UPDATE knowledge_history_imports SET state = 'failed' WHERE id = ${id}`;
  await sql`UPDATE knowledge_history_assets SET sealed_key = null, sealed_at = null WHERE id = ${assetId}`;
  await sql`UPDATE knowledge_history_assets SET sealed_key = ${sourceKey}, sealed_at = now() WHERE id = ${assetId}`;
  await sql`UPDATE knowledge_history_imports SET state = 'committed' WHERE id = ${id}`;
  await sql`UPDATE knowledge_history_imports SET state = 'pending_approval' WHERE id = ${id}`;
  await sql`UPDATE knowledge_history_imports SET state = 'committed' WHERE id = ${id}`;
  await sql`INSERT INTO knowledge_history_assets (id, import_id, alliance_id, name, content_type, size, sha256, position, staging_key)
    VALUES (${nanoid()}, ${id}, ${fixture.alliance.allianceId}, 'large.mp4', 'video/mp4', 536870912, ${hash(sourceBytes)}, 1, 'staging/large')`;

  expect((await request.get("/api/internal/notes/cleanup")).status()).toBe(403);
  expect((await request.get("/api/internal/notes/cleanup", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(403);
  const response = await request.get("/api/internal/notes/cleanup", { headers: { Authorization: "Bearer e2e-notes-cron-secret" } });
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.json()).toEqual({ deleted: 1, failed: 0 });

  const [asset] = await sql`SELECT sealed_key, sealed_at, r2_upload_id FROM knowledge_history_assets WHERE id = ${assetId}`;
  expect(asset).toMatchObject({ sealed_key: null, sealed_at: null, r2_upload_id: null });
  const [row] = await sql`SELECT source_deleted_at FROM knowledge_history_imports WHERE id = ${id}`;
  expect(row.source_deleted_at).not.toBeNull();
  await expect(fs.access(path.join(uploads, sourceKey))).rejects.toThrow();
  await fs.access(path.join(uploads, messageMediaKey));

  const headers = { Cookie: authCookieHeader(fixture.author) };
  const detail = await request.get(`/api/notes/imports/${id}`, { headers });
  expect(detail.status(), await detail.text()).toBe(200);
  const body = (await detail.json()).import;
  expect(body.files.find((file: { id: string }) => file.id === assetId).viewHref).toBeNull();
  expect((await request.get(`/api/notes/imports/${id}/media/${seeded.messageMediaId}`, { headers })).status()).toBe(200);
  const peerHeaders = { Cookie: authCookieHeader(fixture.peer) };
  const peerDetail = await request.get(`/api/notes/imports/${id}`, { headers: peerHeaders });
  expect(peerDetail.status(), await peerDetail.text()).toBe(200);
  const peerPatch = await request.patch(`/api/notes/imports/${id}`, { headers: peerHeaders, data: { requestId: nanoid(), expectedVersion: body.version, edits: [] } });
  expect(peerPatch.status()).toBeGreaterThanOrEqual(400);
});
