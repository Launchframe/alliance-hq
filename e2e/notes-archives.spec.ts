import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";
import { authCookieHeader, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { createNotesFixture } from "./fixtures/notes";
import { draftStateSchema } from "../src/lib/notes/drafts.shared";
import { noteFieldsSchema } from "../src/lib/notes/workspace.shared";

const nextPage = (path: string, cursor: string) => `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ cursor })}`;

test("Team Work resets task paging when personal scope changes", async ({ page }) => {
  const { author, alliance } = await createNotesFixture("officer");
  const sql = getE2eSql(), prefix = nanoid();
  await sql.begin(async (tx) => {
    for (let index = 0; index < 52; index++) {
      const id = `${prefix}_${index}`;
      await tx`INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at) VALUES (${`task:${id}`}, ${alliance.allianceId}, 'task', ${id}, 'hq', ${author.hqUserId}, now())`;
      await tx`INSERT INTO officer_action_items (id, resource_id, alliance_id, title, status, priority, created_by_hq_user_id) VALUES (${id}, ${`task:${id}`}, ${alliance.allianceId}, ${`Scope task ${index}`}, 'open', NULL, ${author.hqUserId})`;
    }
  });
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/en-US/team-work");
  const panel = page.getByTestId("notes-tasks");
  await expect(panel.getByTestId("note-task")).toHaveCount(50);
  const personal = page.getByRole("checkbox", { name: /^my team$/i });
  for (const checked of [false, true]) {
    await panel.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(panel.getByTestId("note-task")).toHaveCount(2);
    const updated = page.waitForResponse((response) => { const url = new URL(response.url()); return url.pathname === "/api/notes/tasks" && url.searchParams.has("personalOnly") === checked && !url.searchParams.has("cursor"); });
    await personal.setChecked(checked);
    expect((await updated).status()).toBe(200);
    await expect(panel.getByTestId("note-task")).toHaveCount(50);
    await expect(panel.getByRole("alert")).toHaveCount(0);
  }
});

for (const target of [
  { view: "studio", path: "/api/notes/knowledge/resources", panel: "notes-studio" },
  { view: "studio", path: "/api/notes/generation", panel: "notes-studio" },
  { view: "knowledge", path: "/api/notes/knowledge/resources", panel: "notes-knowledge" },
  { view: "imports", path: "/api/notes/imports", panel: null },
  { view: "publications", path: "/api/notes/publications", panel: "notes-publications" },
]) test(`${target.view} retries failed ${target.path} reads without creating work`, async ({ page, request }) => {
  const { author } = await createNotesFixture("officer"), headers = { Cookie: authCookieHeader(author) };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Retry read fixture", body: "Private source for read retries." } })).json();
  await page.context().addCookies(playwrightAuthCookies(author));
  let failing = true, writes = 0;
  await page.route((url) => url.pathname === target.path, (route) => failing && route.request().method() === "GET" ? route.fulfill({ status: 503, json: { error: "Fixture read unavailable" } }) : route.continue());
  page.on("request", (request) => { if (/\/api\/notes\/(generation|knowledge|publications|imports)(\/|\?|$)/.test(request.url()) && request.method() !== "GET") writes++; });
  await page.goto(`/notes?${new URLSearchParams({ view: target.view, ...(target.view === "publications" ? { publicationNote: noteId } : {}) })}`);
  const panel = target.panel ? page.getByTestId(target.panel) : page.getByTestId("notes-workspace");
  const retry = panel.getByRole("button", { name: "Retry loading", exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toHaveAttribute("type", "button");
  failing = false;
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === target.path && response.status() === 200);
  await retry.click(); await (await loaded).finished();
  await expect(retry).toHaveCount(0);
  expect(writes).toBe(0);
});

test("revision list and selected revision reads can be retried in place", async ({ page, request }) => {
  const { author } = await createNotesFixture("officer"), headers = { Cookie: authCookieHeader(author) };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Retry history fixture", body: "Original revision text." } })).json();
  const initial = await (await request.get(`/api/notes/${noteId}`, { headers })).json();
  await request.patch(`/api/notes/${noteId}`, { headers, data: { expectedVersion: initial.note.version, body: "Current revision text." } });
  let failure: "list" | "detail" | null = "list";
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.route((url) => url.pathname === `/api/notes/${noteId}/history`, (route) => {
    const detail = new URL(route.request().url()).searchParams.has("version");
    return failure === (detail ? "detail" : "list") ? route.fulfill({ status: 503, json: { error: "Fixture history unavailable" } }) : route.continue();
  });
  await page.goto(`/notes/${noteId}`);
  await page.getByRole("dialog").getByRole("button", { name: "Version history", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Version history", exact: true }), retry = dialog.getByRole("button", { name: "Retry loading", exact: true });
  await expect(retry).toBeVisible(); failure = null; await retry.click();
  const revision = dialog.getByRole("button", { name: /Version 1/ });
  await expect(revision).toBeVisible(); failure = "detail"; await revision.click();
  await expect(retry).toBeVisible(); failure = null; await retry.click();
  await expect(dialog).toContainText("Original revision text.");
  await expect(retry).toHaveCount(0);
});

test("selected snapshot retries are reads rather than new previews", async ({ page, request }) => {
  const { author } = await createNotesFixture("officer"), headers = { Cookie: authCookieHeader(author) };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Retry snapshot note", body: "Private source." } })).json();
  const { note } = await (await request.get(`/api/notes/${noteId}`, { headers })).json();
  const prepared = await request.post("/api/notes/publications", { headers, data: { requestId: nanoid(), noteId, expectedVersion: note.version, title: "Retry snapshot", body: "Reviewed synthetic snapshot.", locale: "en-US", days: 7 } });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const preview = await prepared.json();
  await page.context().addCookies(playwrightAuthCookies(author));
  let failing = true;
  await page.route((url) => url.pathname === `/api/notes/publications/${preview.id}`, (route) => failing ? route.fulfill({ status: 503, json: { error: "Fixture snapshot unavailable" } }) : route.continue());
  await page.goto(`/notes?view=publications&publicationNote=${noteId}`);
  await page.getByTestId("publication-history").getByRole("button", { name: /^Retry snapshot ·/ }).click();
  const retry = page.getByRole("button", { name: "Retry loading", exact: true });
  await expect(retry).toBeVisible(); failing = false; await retry.click();
  await expect(page.getByTestId("publication-preview")).toContainText("Reviewed synthetic snapshot.");
  const [count] = await getE2eSql()`SELECT count(*)::integer AS count FROM knowledge_publications WHERE note_id = ${noteId}`;
  expect(count.count).toBe(1);
});

test("linked task controls never submit the surrounding unsaved note", async ({ page, request }) => {
  const { author } = await createNotesFixture();
  const headers = { Cookie: authCookieHeader(author) };
  const created = await request.post("/api/notes", { headers, data: { title: "Parent document", body: "Saved parent body" } });
  expect(created.status(), await created.text()).toBe(200);
  const { noteId } = await created.json();
  const task = await request.post("/api/notes/tasks", { headers, data: { title: "Linked task", sourceNoteId: noteId, labels: ["archive"], requestId: nanoid() } });
  expect(task.ok(), await task.text()).toBe(true);
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto(`/notes/${noteId}`);
  const dialog = page.getByRole("dialog", { name: "Parent document", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Write", exact: true }).click();
  await dialog.getByLabel("Note", { exact: true }).fill("Unsaved parent changes");
  await dialog.locator("form").evaluate((form) => { form.addEventListener("submit", () => { form.setAttribute("data-submit-count", String(Number(form.getAttribute("data-submit-count") ?? 0) + 1)); }, true); });
  const label = dialog.getByTestId("notes-tasks").getByRole("button", { name: "archive", exact: true });
  await expect(label).toHaveAttribute("type", "button");
  await label.click();
  expect(await dialog.locator("form").getAttribute("data-submit-count")).toBeNull();
  await expect(dialog.getByLabel("Note", { exact: true })).toHaveValue("Unsaved parent changes");
});

test("older drafts, tasks, reviews and snapshots remain reachable without bulk document bodies", async ({ request, page }) => {
  test.setTimeout(180_000);
  const { author, peer, alliance } = await createNotesFixture("officer");
  const sql = getE2eSql(), prefix = nanoid(8), headers = { Cookie: authCookieHeader(author) }, peerHeaders = { Cookie: authCookieHeader(peer) };
  const id = (kind: string, index: number) => `${kind}_${prefix}_${String(index).padStart(3, "0")}`;
  const noteId = id("note", 0), draftBody = "Private draft text. ".repeat(150), taskBody = `${"Complete task details. ".repeat(200)}Hidden task ending`;
  await sql.begin(async (tx) => {
    for (let index = 0; index < 55; index++) {
      const note = id("note", index), draft = id("draft", index), generation = id("generation", index);
      await tx`INSERT INTO performance_notes (id, alliance_id, kind, intake_mode, title, body, source, created_by_hq_user_id, created_at, updated_at)
        VALUES (${note}, ${alliance.allianceId}, 'note', 'thought', ${`Archive note ${index}`}, 'Current note body', 'web', ${author.hqUserId},
          '2026-09-01'::timestamptz + ${index} * interval '1 microsecond', '2026-09-01'::timestamptz + ${index} * interval '1 microsecond')`;
      await tx`UPDATE knowledge_resources SET knowledge_approved_version = content_version, updated_at = '2026-09-01'::timestamptz + ${index} * interval '1 microsecond' WHERE id = ${`note:${note}`}`;
      for (const resource of [draft, generation]) await tx`INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at)
        VALUES (${`draft:${resource}`}, ${alliance.allianceId}, 'draft', ${resource}, 'hq', ${author.hqUserId}, now())`;
      const state = draftStateSchema.parse({ fields: { title: `Archive draft ${index}`, body: draftBody }, aiEnabled: false });
      await tx`INSERT INTO knowledge_capture_drafts (id, alliance_id, resource_id, source, state, state_hash, updated_at)
        VALUES (${draft}, ${alliance.allianceId}, ${`draft:${draft}`}, 'web', ${tx.json(state)}, ${createHash("sha256").update(JSON.stringify(state)).digest("hex")}, '2026-09-01'::timestamptz + ${index} * interval '1 microsecond')`;
      await tx`INSERT INTO knowledge_generation_jobs (id, alliance_id, resource_id, requester_id, session_id, kind, locale, model, evidence, input_ids, state, created_at)
        VALUES (${generation}, ${alliance.allianceId}, ${`draft:${generation}`}, ${author.hqUserId}, ${author.sessionId}, 'synthesize', 'en-US', 'fixture', '[]'::jsonb, '[]'::jsonb, 'cancelled', '2026-09-01'::timestamptz + ${index} * interval '1 microsecond')`;
      const version = index + 1;
      const snapshot = { ...noteFieldsSchema.parse({ title: "Archive note 0", body: version === 1 ? "Revision original only" : "Current note body" }), archived: false };
      await tx`INSERT INTO knowledge_note_revisions (id, note_id, alliance_id, version, snapshot, edited_by_hq_user_id)
        VALUES (${id("revision", index)}, ${noteId}, ${alliance.allianceId}, ${version}, ${tx.json(snapshot)}, ${author.hqUserId})`;
      await tx`INSERT INTO knowledge_publications (id, alliance_id, note_id, resource_id, owner_hq_user_id, source_version, snapshot_version, title, body, locale, state, expires_at)
        VALUES (${id("publication", index)}, ${alliance.allianceId}, ${noteId}, ${`note:${noteId}`}, ${author.hqUserId}, 55, ${version}, ${`Archive snapshot ${version}`}, 'Snapshot original only', 'en-US', ${version === 1 ? "draft" : "revoked"}, now() + interval '7 days')`;
    }
    await tx`UPDATE knowledge_resources SET version = 55, content_version = 55, knowledge_approved_version = 55 WHERE id = ${`note:${noteId}`}`;
    for (let index = 0; index < 110; index++) {
      const task = id("task", index);
      await tx`INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at)
        VALUES (${`task:${task}`}, ${alliance.allianceId}, 'task', ${task}, 'hq', ${author.hqUserId}, now())`;
      await tx`INSERT INTO officer_action_items (id, resource_id, alliance_id, source_note_id, title, description, status, priority, labels, created_by_hq_user_id, updated_at)
        VALUES (${task}, ${`task:${task}`}, ${alliance.allianceId}, ${noteId}, ${`Archive task ${index}`}, ${index === 0 ? taskBody : "Finished work"}, ${index === 0 ? "open" : "done"}, NULL, '["archive"]'::jsonb, ${author.hqUserId}, '2026-09-01'::timestamptz + ${index} * interval '1 microsecond')`;
    }
  });
  const get = async (path: string) => {
    const response = await request.get(path, { headers });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const drafts = await get("/api/notes/drafts");
  expect(drafts.drafts).toHaveLength(50);
  expect(JSON.stringify(drafts)).not.toContain(draftBody);
  const olderDrafts = await get(nextPage("/api/notes/drafts", drafts.nextCursor));
  expect(olderDrafts.drafts.at(-1).id).toBe(id("draft", 0));
  expect((await get(nextPage("/api/notes/drafts", olderDrafts.previousCursor))).drafts[0].id).toBe(id("draft", 54));
  expect((await request.get(nextPage("/api/notes/drafts", drafts.nextCursor), { headers: peerHeaders })).status()).toBe(403);
  expect((await get("/api/notes?format=summary")).draftCount).toBe(55);
  const tasks = await get("/api/notes/tasks?format=summary&status=active");
  expect(tasks.tasks.map((task: { id: string }) => task.id)).toEqual([id("task", 0)]);
  expect(tasks.tasks[0]).not.toHaveProperty("description");
  expect(tasks.tasks[0]).not.toHaveProperty("intakeProvenance");
  expect(tasks.tasks[0].excerpt.length).toBeLessThanOrEqual(240);
  const allTasks = await get("/api/notes/tasks?format=summary&status=all");
  const taskPage2 = await get(nextPage("/api/notes/tasks?format=summary&status=all", allTasks.nextCursor));
  const taskPage3 = await get(nextPage("/api/notes/tasks?format=summary&status=all", taskPage2.nextCursor));
  expect(taskPage3.tasks.at(-1).id).toBe(id("task", 0));
  expect((await request.get(nextPage("/api/notes/tasks?format=summary&status=done", allTasks.nextCursor), { headers })).status()).toBe(400);
  expect((await get(`/api/notes/tasks/${id("task", 0)}`)).task.description).toBe(taskBody);
  const historyPath = `/api/notes/${noteId}/history?format=summary`;
  const revisions = await get(historyPath);
  expect(revisions.items).toHaveLength(50);
  expect(revisions.items[0]).not.toHaveProperty("snapshot");
  expect((await get(nextPage(historyPath, revisions.nextCursor))).items.at(-1).version).toBe(1);
  expect((await get(`/api/notes/${noteId}/history?version=1`)).revision.snapshot.body).toBe("Revision original only");
  expect((await request.get(historyPath, { headers: peerHeaders })).status()).toBe(404);
  const library = await get("/api/notes/knowledge/resources?format=page");
  expect(library.items).toHaveLength(50);
  expect((await get(nextPage("/api/notes/knowledge/resources?format=page", library.nextCursor))).items.at(-1).resourceId).toBe(`note:${noteId}`);
  expect((await request.get(nextPage("/api/notes/knowledge/resources?format=page&owned=true", library.nextCursor), { headers })).status()).toBe(400);
  const reviews = await get("/api/notes/generation?format=page");
  expect((await get(nextPage("/api/notes/generation?format=page", reviews.nextCursor))).items.at(-1).id).toBe(id("generation", 0));
  expect((await request.get(nextPage("/api/notes/generation?format=page", drafts.nextCursor), { headers })).status()).toBe(400);
  const publicationPath = `/api/notes/publications?noteId=${noteId}&format=summary`;
  const publications = await get(publicationPath);
  expect(publications.items).toHaveLength(50);
  expect(publications.items[0]).not.toHaveProperty("body");
  expect(publications.items[0]).not.toHaveProperty("link");
  expect((await get(nextPage(publicationPath, publications.nextCursor))).items.at(-1).snapshotVersion).toBe(1);
  expect((await get(`/api/notes/publications/${id("publication", 0)}`)).body).toBe("Snapshot original only");
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=tasks");
  await page.getByTestId("note-task").getByRole("button", { name: /Archive task 0/ }).click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(taskBody);
  await taskDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/notes?view=drafts");
  const draftList = page.getByTestId("notes-drafts");
  await draftList.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(draftList.getByRole("button", { name: /^Archive draft 0/ })).toBeVisible();
  await page.reload();
  await expect(draftList.getByRole("button", { name: /^Archive draft 0/ })).toBeVisible();
  await page.goto("/notes?view=studio");
  const studio = page.getByTestId("notes-studio");
  await studio.locator("aside").getByRole("button", { name: "Next page", exact: true }).click();
  await expect(studio.locator("aside").getByRole("button", { name: /000$/ })).toBeVisible();
  await studio.locator("fieldset").getByRole("button", { name: "Next resources", exact: true }).click();
  await studio.getByRole("checkbox", { name: "Archive note 0", exact: true }).check();
  await expect(studio.getByRole("checkbox", { name: "Archive note 0", exact: true })).toBeChecked();
  await page.goto(`/notes?${new URLSearchParams({ view: "publications", publicationNote: noteId })}`);
  const publicationList = page.getByTestId("publication-history");
  await publicationList.getByRole("button", { name: "Next page", exact: true }).click();
  await publicationList.getByRole("button", { name: /^Archive snapshot 1 ·/ }).click();
  await expect(page.getByTestId("publication-preview").getByText("Snapshot original only", { exact: true })).toBeVisible();
  const shared = await request.put(`/api/notes/${noteId}/sharing`, { headers, data: { expectedVersion: (await get(`/api/notes/${noteId}`)).note.version, grants: [{ subjectKind: "user", subjectId: peer.hqUserId, role: "edit" }] } });
  expect(shared.status(), await shared.text()).toBe(200);
  expect((await request.get(`/api/notes/${noteId}`, { headers: peerHeaders })).status()).toBe(200);
  for (const path of [historyPath, `/api/notes/${noteId}/history?version=1`, publicationPath, `/api/notes/publications/${id("publication", 0)}`]) {
    expect((await request.get(path, { headers: peerHeaders })).status()).toBe(404);
  }
  const [usage] = await sql`SELECT count(*)::integer AS count FROM knowledge_ai_usage WHERE principal_key = ${`hq:${author.hqUserId}`}`;
  expect(usage.count).toBe(0);
});
