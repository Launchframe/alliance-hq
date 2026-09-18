import { expect, test } from "@playwright/test";
import { authCookieHeader, playwrightAuthCookies, getE2eSql, createBrowserSession, createNativeAlliance, createAllianceMembership } from "./fixtures/db";
import { nanoid } from "nanoid";
import { createNotesFixture as fixture } from "./fixtures/notes";

test("empty notebooks keep their empty hint and new-note action", async ({ page }) => {
  const { author } = await fixture();
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=notebook&notebook=Empty");
  const empty = page.locator("div").filter({ has: page.getByRole("heading", { name: "A place for what matters", exact: true }) }).filter({ has: page.getByRole("button", { name: "New note", exact: true }) }).last();
  await expect(page.getByRole("heading", { name: "A place for what matters", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  await empty.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New note", exact: true })).toBeVisible();
});

test("label and commander filters are exact, combined, scoped and restored from card actions", async ({ page, request }) => {
  const { author, peer, cookie, ferg } = await fixture("officer");
  const headers = { Cookie: authCookieHeader(author) };
  const add = async (title: string, labels: string[], member: string, asPeer = false) => {
    const response = await request.post("/api/notes", { headers: asPeer ? { Cookie: authCookieHeader(peer) } : headers, data: { title, body: "Raid planning appears in this prose", labels, memberIds: [member] } });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).noteId as string;
  };
  const matching = await add("Matching note", ["Raid planning"], cookie.ashedMemberId);
  await add("Other label", ["Different"], cookie.ashedMemberId);
  await add("Other commander", ["Raid planning"], ferg.ashedMemberId);
  await add("Hidden peer note", ["Raid planning"], cookie.ashedMemberId, true);
  const list = async (label: string, member = "") => (await (await request.get(`/api/notes?${new URLSearchParams({ format: "summary", label, member })}`, { headers })).json()).items;
  expect(await list("Raid planning")).toHaveLength(2);
  expect((await list("Raid planning", cookie.ashedMemberId)).map((note: { id: string }) => note.id)).toEqual([matching]);
  expect(await list("Raid")).toHaveLength(0);
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes");
  const card = page.locator(`[data-note-id="${matching}"]`);
  await card.getByRole("button", { name: "Raid planning", exact: true }).click();
  await expect(page.getByTestId("note-card")).toHaveCount(2);
  await card.getByRole("button", { name: "Cookie", exact: true }).click();
  await expect(page.getByTestId("note-card")).toHaveCount(1);
  await expect(page).toHaveURL((url) => url.searchParams.get("member") === cookie.ashedMemberId);
  await page.reload();
  await expect(page.getByTestId("note-card")).toHaveCount(1);
  await expect(page.getByText("Hidden peer note", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByTestId("note-card")).toHaveCount(3);
});

test("workspace preferences are versioned and isolated by both account and alliance", async ({ request }) => {
  const { author, peer, alliance } = await fixture("officer");
  const sql = getE2eSql(), headers = { Cookie: authCookieHeader(author) }, peerHeaders = { Cookie: authCookieHeader(peer) };
  expect((await request.get("/api/notes/preferences")).status()).toBe(401);
  const bootstrap = await createBrowserSession(sql);
  expect((await request.get("/api/notes/preferences", { headers: { Cookie: `alliance_hq_session=${bootstrap.sessionId}` } })).status()).toBe(403);
  const initial = await (await request.get("/api/notes/preferences", { headers })).json();
  expect(initial).toMatchObject({ version: 0, scope: `${alliance.allianceId}:${author.hqUserId}`, state: { view: "notebook", layout: "cards" } });
  const input = { expectedScope: initial.scope, expectedVersion: 0, state: { ...initial.state, view: "inbox", layout: "list", q: "two words " } };
  const staleScope = await request.put("/api/notes/preferences", { headers: { ...headers, "X-Notes-Scope": "other:principal" }, data: input });
  expect(staleScope.status(), await staleScope.text()).toBe(403);
  expect((await (await request.get("/api/notes/preferences", { headers })).json()).version).toBe(0);
  const saved = await request.put("/api/notes/preferences", { headers: { ...headers, "X-Notes-Scope": initial.scope }, data: input });
  expect(saved.status(), await saved.text()).toBe(200);
  expect((await saved.json()).version).toBe(1);
  expect((await request.put("/api/notes/preferences", { headers, data: input })).status()).toBe(409);
  expect((await request.put("/api/notes/preferences", { headers: peerHeaders, data: input })).status()).toBe(403);
  expect((await request.put("/api/notes/preferences", { headers, data: { ...input, expectedVersion: 1, state: { ...input.state, body: "Must not store a note body" } } })).status()).toBe(400);
  expect((await (await request.get("/api/notes/preferences", { headers: peerHeaders })).json()).state.view).toBe("notebook");
  const crossed = await request.post("/api/notes", { headers: { ...peerHeaders, "X-Notes-Scope": initial.scope }, data: { body: "Must not cross accounts" } });
  expect(crossed.status()).toBe(403);
  expect((await (await request.get("/api/notes", { headers: peerHeaders })).json()).notes).toHaveLength(0);
  const otherAlliance = await createNativeAlliance(sql, { tag: `PREF${nanoid(3)}`, name: "Other preference scope" });
  await createAllianceMembership(sql, { allianceId: otherAlliance.allianceId, hqUserId: author.hqUserId, roleName: "officer", source: "manual" });
  const otherSession = await createBrowserSession(sql);
  await sql`UPDATE sessions SET hq_user_id = ${author.hqUserId}, current_alliance_id = ${otherAlliance.allianceId} WHERE id = ${otherSession.sessionId}`;
  const otherHeaders = { Cookie: authCookieHeader({ ...author, sessionId: otherSession.sessionId }) };
  const other = await (await request.get("/api/notes/preferences", { headers: otherHeaders })).json();
  expect(other).toMatchObject({ version: 0, state: { view: "notebook" } });
  expect((await request.put("/api/notes/preferences", { headers: otherHeaders, data: { ...input, expectedScope: other.scope, state: { ...other.state, view: "tasks" } } })).status()).toBe(200);
  expect((await (await request.get("/api/notes/preferences", { headers })).json()).state.view).toBe("inbox");
});

test("preference conflicts wait for explicit retry rather than overwrite another tab", async ({ page, request }) => {
  const { author } = await fixture("officer"), headers = { Cookie: authCookieHeader(author) };
  const initial = await (await request.get("/api/notes/preferences", { headers })).json();
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.clock.install();
  await page.goto("/notes");
  await expect(page.getByTestId("notes-workspace")).toBeVisible();
  const other = await request.put("/api/notes/preferences", { headers, data: { expectedScope: initial.scope, expectedVersion: 0, state: { ...initial.state, layout: "list", q: "Other tab preference" } } });
  expect(other.status()).toBe(200);
  let writes = 0;
  await page.route("**/api/notes/preferences", (route) => { if (route.request().method() === "PUT") writes++; return route.continue(); });
  await page.getByLabel("Source", { exact: true }).selectOption("web");
  await page.clock.runFor(700);
  const retry = page.getByRole("button", { name: "Retry saving preferences", exact: true });
  await expect(retry).toBeVisible();
  await page.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await page.clock.runFor(1000);
  expect(writes).toBe(1);
  expect(await (await request.get("/api/notes/preferences", { headers })).json()).toMatchObject({ version: 1, state: { layout: "list", q: "Other tab preference" } });
  await retry.click();
  await expect.poll(async () => (await (await request.get("/api/notes/preferences", { headers })).json()).state.priority).toBe("urgent");
  expect(writes).toBe(2);
  await expect(retry).toHaveCount(0);
});

test("malformed workspace URLs recover saved preferences without hiding a readable note", async ({ page, request }) => {
  const { author } = await fixture("officer"), headers = { Cookie: authCookieHeader(author) };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Readable query fixture", body: "Authorized document with a malformed URL." } })).json();
  const initial = await (await request.get("/api/notes/preferences", { headers })).json();
  await request.put("/api/notes/preferences", { headers, data: { expectedScope: initial.scope, expectedVersion: 0, state: { ...initial.state, view: "inbox", layout: "list" } } });
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto(`/notes/${noteId}?view=bogus&cursor=%7B`);
  await expect(page.getByRole("dialog")).toContainText("Authorized document with a malformed URL.");
  await expect(page).toHaveURL((url) => url.searchParams.get("view") === "inbox" && !url.searchParams.has("cursor"));
  await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("leaving an edited publication offers no misleading keep action or implicit snapshot", async ({ page, request }) => {
  const { author } = await fixture("officer"), headers = { Cookie: authCookieHeader(author) };
  const { noteId } = await (await request.post("/api/notes", { headers, data: { title: "Publication guard fixture", body: "Private source text." } })).json();
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto(`/notes?view=publications&publicationNote=${noteId}`);
  await page.getByLabel("Public title", { exact: true }).fill("Uncommitted public title");
  await page.getByRole("button", { name: /^Notebook/ }).click();
  const guard = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
  await expect(guard).toBeVisible();
  await expect(guard.getByRole("button", { name: "Keep draft and close", exact: true })).toHaveCount(0);
  await guard.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Public title", { exact: true })).toHaveValue("Uncommitted public title");
  await page.getByRole("button", { name: /^Notebook/ }).click();
  await guard.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByTestId("notes-publications")).toHaveCount(0);
  const [snapshots] = await getE2eSql()`SELECT count(*)::integer AS count FROM knowledge_publications WHERE note_id = ${noteId}`;
  expect(snapshots.count).toBe(0);
});

test("restores scoped view filters across reload, back and forward, and retries preference saves", async ({ page, request }) => {
  const { author } = await fixture();
  const headers = { Cookie: authCookieHeader(author) };
  await request.post("/api/notes", { headers, data: { title: "Alpha plan", body: "Alpha plan details" } });
  const initial = await (await request.get("/api/notes/preferences", { headers })).json();
  await request.put("/api/notes/preferences", { headers, data: { expectedScope: initial.scope, expectedVersion: 0, state: { ...initial.state, view: "inbox", layout: "list" } } });
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes");
  await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/view=inbox/);
  const source = page.getByLabel("Source", { exact: true });
  await source.selectOption("discord");
  await expect(page).toHaveURL((url) => url.searchParams.get("source") === "discord");
  await page.goBack();
  await expect(page).toHaveURL((url) => url.searchParams.get("source") === "");
  await expect(source).toHaveValue("");
  await page.goForward();
  await expect(source).toHaveValue("discord");
  await source.selectOption("web");
  const query = page.getByRole("searchbox");
  await query.fill("Alpha"); await query.press("End"); await query.press("Space");
  await expect(query).toHaveValue("Alpha ");
  await query.pressSequentially("plan");
  await page.goBack(); await expect(query).toHaveValue("");
  await page.goForward(); await expect(query).toHaveValue("Alpha plan");
  await expect.poll(async () => (await (await request.get("/api/notes/preferences", { headers })).json()).state.q).toBe("Alpha plan");
  await page.reload();
  await expect(query).toHaveValue("Alpha plan");
  await expect(source).toHaveValue("web");
  await page.route("**/api/notes/preferences", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: {} }) : route.continue());
  await page.getByRole("button", { name: "Card view", exact: true }).click();
  await expect(page.getByText("Couldn’t save your view preferences. Your current view is unchanged.", { exact: true })).toBeVisible();
  await page.unroute("**/api/notes/preferences");
  await page.getByRole("button", { name: "Retry saving preferences", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/notes/preferences", { headers })).json()).state.layout).toBe("cards");
});

test("secondary views restore authorized URL state without implicit AI processing", async ({ page, request, browser }) => {
  const { author, peer, alliance } = await fixture("officer");
  const headers = { Cookie: authCookieHeader(author) };
  const created = await request.post("/api/notes", { headers, data: { title: "Navigation evidence", body: "Authorized detailed words." } });
  const { noteId } = await created.json();
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes?view=search&searchQuery=Navigation&searchKind=note&searchRun=1");
  await expect(page.getByTestId("notes-search").getByRole("heading", { name: "Navigation evidence", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("notes-search").getByRole("heading", { name: "Navigation evidence", exact: true })).toBeVisible();
  await page.goto(`/notes?${new URLSearchParams({ view: "knowledge", knowledge: `note:${noteId}`, knowledgeQuery: "Navigation", knowledgeSources: "1" })}`);
  const knowledge = page.getByTestId("notes-knowledge");
  await expect(knowledge.getByRole("heading", { name: "Navigation evidence", exact: true })).toBeVisible();
  await expect(knowledge.locator("input[maxlength='200']")).toHaveValue("Navigation");
  await expect(knowledge.getByRole("checkbox").last()).toBeChecked();
  await page.goto("/notes?view=studio&studioKind=localize&studioSources=1");
  await expect(page.getByTestId("notes-studio").getByRole("combobox")).toHaveValue("localize");
  await page.goto(`/notes?${new URLSearchParams({ view: "publications", publicationNote: noteId, publicationQuery: "Navigation" })}`);
  const publication = page.getByTestId("notes-publications");
  await expect(publication.getByRole("textbox", { name: "Public text", exact: true })).toHaveValue("Authorized detailed words.");
  await page.reload();
  await expect(publication.getByRole("textbox", { name: "Public text", exact: true })).toHaveValue("Authorized detailed words.");
  const other = await browser.newContext();
  await other.addCookies(playwrightAuthCookies(peer));
  const otherPage = await other.newPage();
  await otherPage.goto(`/notes?${new URLSearchParams({ workspaceScope: `${alliance.allianceId}:${author.hqUserId}`, view: "search", q: "Private filter sentinel", searchQuery: "Private filter sentinel", searchRun: "1" })}`);
  await expect(otherPage.getByTestId("notes-workspace").getByRole("searchbox")).toHaveValue("");
  await expect(otherPage.getByText("Private filter sentinel", { exact: true })).toHaveCount(0);
  await other.close();
  const [usage] = await getE2eSql()`SELECT count(*)::integer AS count FROM knowledge_ai_usage WHERE principal_key = ${`hq:${author.hqUserId}`}`;
  expect(usage.count).toBe(0);
});

test("browser navigation protects and resumes an uncommitted private capture", async ({ page, request }) => {
  const { author } = await fixture();
  const headers = { Cookie: authCookieHeader(author) };
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  const note = page.getByRole("dialog", { name: "New note", exact: true });
  await note.getByLabel("Note", { exact: true }).fill("Keep this private thought.");
  await page.goBack();
  const guard = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(note.getByLabel("Note", { exact: true })).toHaveValue("Keep this private thought.");
  await page.goBack();
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep draft and close", exact: true }).click();
  await expect(note).not.toBeVisible();
  expect((await (await request.get("/api/notes", { headers })).json()).notes).toHaveLength(0);
  expect((await (await request.get("/api/notes/tasks", { headers })).json()).tasks).toHaveLength(0);
  await page.goForward();
  await expect(note.getByLabel("Note", { exact: true })).toHaveValue("Keep this private thought.");
  const stored = await page.evaluate(() => Object.values(localStorage).join(" "));
  expect(stored).not.toContain("Keep this private thought.");
});

test("pages compact summaries without hiding older documents, counts, notebooks or publication sources", async ({ page, request }) => {
  const { author, peer, alliance } = await fixture("officer");
  const sql = getE2eSql(), headers = { Cookie: authCookieHeader(author) }, prefix = nanoid();
  const fullBody = `${"Long private prose. ".repeat(60)}Hidden ending marker`;
  const ids: string[] = [];
  for (let index = 0; index < 52; index++) {
    const id = `${prefix}_${String(index).padStart(3, "0")}`; ids.push(id);
    await sql`INSERT INTO performance_notes (id, alliance_id, kind, intake_mode, source, created_by_hq_user_id, title, body, notebook, updated_at)
      VALUES (${id}, ${alliance.allianceId}, 'note', 'thought', 'web', ${author.hqUserId}, ${`Paged note ${index}`}, ${fullBody}, ${index === 0 ? "Older notebook" : null}, '2026-09-16T01:02:03.123456Z'::timestamptz)`;
  }
  await request.post("/api/notes", { headers: { Cookie: authCookieHeader(peer) }, data: { title: "Peer private title", body: "Other officer private marker", notebook: "Peer private notebook" } });
  const firstResponse = await request.get("/api/notes?format=summary", { headers });
  expect(firstResponse.status(), await firstResponse.text()).toBe(200);
  const first = await firstResponse.json();
  expect(first.items).toHaveLength(50);
  expect(first.counts).toMatchObject({ notebook: 52, inbox: 52, shared: 0 });
  expect(first.notebooks).toEqual(["Older notebook"]);
  expect(first.roster).toBeUndefined();
  expect(first.items.every((item: Record<string, unknown>) => !("body" in item) && !("keyDecisions" in item) && !("intakeProvenance" in item))).toBe(true);
  expect(JSON.stringify(first)).not.toMatch(/Hidden ending marker|Other officer private marker|Peer private notebook/);
  const cursorUrl = `/api/notes?${new URLSearchParams({ format: "summary", cursor: first.nextCursor })}`;
  const secondResponse = await request.get(cursorUrl, { headers });
  expect(secondResponse.status(), await secondResponse.text()).toBe(200);
  const second = await secondResponse.json();
  expect(second.items.map((item: { id: string }) => item.id)).toEqual([ids[1], ids[0]]);
  expect(second.nextCursor).toBeNull();
  expect((await request.get(cursorUrl, { headers: { Cookie: authCookieHeader(peer) } })).status()).toBe(403);
  expect((await request.get(`${cursorUrl}&priority=urgent`, { headers })).status()).toBe(400);
  expect((await request.get("/api/notes?format=summary")).status()).toBe(401);
  const search = await (await request.get("/api/notes?format=summary&q=Hidden%20ending%20marker&notebook=Older%20notebook", { headers })).json();
  expect(search.items.map((item: { id: string }) => item.id)).toEqual([ids[0]]);
  const html = await (await request.get("/notes", { headers })).text();
  expect(html).not.toContain("Hidden ending marker");
  expect(html).not.toContain("Other officer private marker");
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes");
  await expect(page.getByTestId("note-card")).toHaveCount(50);
  await expect(page.getByRole("button", { name: "Older notebook", exact: true })).toBeVisible();
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { captured = resolve; });
  let intercepted = false;
  const pagedList = (url: URL) => url.pathname === "/api/notes" && url.searchParams.has("cursor");
  await page.route(pagedList, async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch(); captured(); await held; await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await ready;
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    release();
    await expect(page.getByTestId("note-card")).toHaveCount(2);
    await expect(page.getByTestId("notes-list-count")).toHaveText("52");
    await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeEnabled();
  } finally { release(); await page.unroute(pagedList); }
  const oldest = page.getByTestId("note-card").filter({ hasText: "Paged note 0" });
  await oldest.getByRole("button").first().click();
  const editor = page.getByRole("dialog");
  await expect(editor).toContainText("Hidden ending marker");
  await editor.getByRole("button", { name: "Write", exact: true }).click();
  await expect(editor.getByLabel("Note", { exact: true })).toHaveValue(fullBody);
  await editor.getByLabel("Note", { exact: true }).fill(`${fullBody} Reviewed.`);
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect((await (await request.get(`/api/notes/${ids[0]}`, { headers })).json()).note.body).toBe(`${fullBody} Reviewed.`);
  for (const cursor of ["{", JSON.stringify({ ...JSON.parse(first.nextCursor), scope: `${alliance.allianceId}:${peer.hqUserId}` })]) {
    await page.goto(`/notes/${ids[1]}?${new URLSearchParams({ cursor })}`);
    await expect(page.getByRole("dialog")).toContainText("Hidden ending marker");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("notes-workspace")).toBeVisible();
  }
  await page.goto("/notes?view=publications");
  const publication = page.getByTestId("notes-publications");
  await publication.getByRole("button", { name: "Next page", exact: true }).click();
  const selectedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/notes/${ids[1]}`);
  await publication.getByLabel("Source note", { exact: true }).selectOption({ label: "Paged note 1" });
  const selectedNote = await selectedResponse;
  expect(selectedNote.status(), await selectedNote.text()).toBe(200);
  expect((await selectedNote.json()).scope).toBe(first.scope);
  await expect(publication.getByRole("textbox", { name: "Public text", exact: true })).toHaveValue(fullBody);
});

for (const status of [401, 403, 404]) test(`single-note ${status} clears only the appropriate scope`, async ({ page }) => {
  const { author } = await fixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  const created = await page.request.post("/api/notes", { data: { title: "Protected detail fixture", body: "Private detail fixture" } });
  const { noteId } = await created.json();
  await page.goto("/notes");
  const card = page.getByTestId("note-card").filter({ hasText: "Protected detail fixture" });
  await expect(card).toBeVisible();
  await page.route(`**/api/notes/${noteId}`, (route) => route.fulfill({ status, json: { error: "Fixture detail denied" } }));
  await card.getByRole("button").first().click();
  if (status === 404) { await expect(card.getByRole("alert")).toBeVisible(); await expect(page.getByTestId("notes-workspace")).toBeVisible(); }
  else { await expect(page.getByTestId("notes-workspace")).toHaveCount(0); await expect(page.getByRole("dialog")).toHaveCount(0); }
});

for (const target of ["draft", "publication-list", "publication-detail"] as const) test(`${target} denial clears the entire cached Notes workspace`, async ({ page }) => {
  const { author } = await fixture("officer");
  await page.context().addCookies(playwrightAuthCookies(author));
  const created = await page.request.post("/api/notes", { data: { title: "Protected publication fixture", body: "Private publication fixture" } });
  const { noteId } = await created.json();
  if (target === "draft") {
    await page.route("**/api/notes/drafts/denied-draft", (route) => route.fulfill({ status: 401, body: "Fixture session expired" }));
    await page.goto("/notes?draft=denied-draft");
  } else {
    if (target === "publication-list") await page.route((url) => url.pathname === "/api/notes" && url.searchParams.get("format") === "summary", (route) => route.fulfill({ status: 403, body: "Fixture access denied" }));
    await page.goto("/notes?view=publications");
    if (target === "publication-detail") {
      await page.route(`**/api/notes/${noteId}`, (route) => route.fulfill({ status: 401, body: "Fixture session expired" }));
      await page.getByLabel("Source note", { exact: true }).selectOption({ label: "Protected publication fixture" });
    }
  }
  await expect(page.getByTestId("notes-workspace")).toHaveCount(0);
  await expect(page.getByTestId("notes-publications")).toHaveCount(0);
});

test("captures and edits notes with stable manual member exclusions and nullable priority", async ({ page }) => {
  const { author, cookie, ferg } = await fixture();
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/notes");
  await expect(page.getByTestId("notes-workspace")).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Rally coverage");
  await dialog.getByLabel("Note", { exact: true }).fill("Cookie and Ferg will check our rally coverage.");
  await expect(dialog.getByRole("button", { name: "Unlink Cookie", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Unlink Ferg", exact: true }).click();
  await dialog.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await dialog.getByLabel("Labels", { exact: true }).fill("Rallies, Coverage");
  await dialog.getByLabel("Notebook", { exact: true }).fill("Private strategy");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const card = page.getByTestId("note-card").filter({ hasText: "Rally coverage" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Urgent");
  const noteId = await card.getAttribute("data-note-id");
  await card.getByRole("button").first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Write", exact: true }).click();
  await dialog.getByLabel("Note", { exact: true }).fill("Cookie and Ferg will check our rally coverage. Updated details.");
  await expect(dialog.getByRole("button", { name: "Unlink Ferg", exact: true })).toHaveCount(0);
  await dialog.getByLabel("Priority", { exact: true }).selectOption("none");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const response = await page.request.get(`/api/notes/${noteId}`);
  expect(response.status()).toBe(200);
  const { note } = await response.json();
  expect(note.priority).toBeNull();
  expect(note.members.map((member: { ashedMemberId: string }) => member.ashedMemberId)).toEqual([cookie.ashedMemberId]);
  expect(note.excludedMemberIds).toContain(ferg.ashedMemberId);
  expect(note.source).toBe("web");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  await card.getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last()).toBeInViewport();
});

test("shares current content without private organization or history and honors revocation", async ({ page, browser }) => {
  const { author, peer } = await fixture();
  await page.context().addCookies(playwrightAuthCookies(author));
  const created = await page.request.post("/api/notes", { data: { title: "Shared rally brief", body: "First private version", notebook: "Private strategy" } });
  expect(created.status()).toBe(200);
  const { noteId, notes } = await created.json();
  const saved = notes.find((note: { id: string }) => note.id === noteId);
  const edited = await page.request.patch(`/api/notes/${noteId}`, { data: { expectedVersion: saved.version, body: "Current shareable brief" } });
  expect(edited.status()).toBe(200);
  await page.goto("/notes");
  const card = page.getByTestId("note-card").filter({ hasText: "Shared rally brief" });
  await card.getByRole("button", { name: "Share", exact: true }).click();
  const sharing = page.getByRole("dialog", { name: "Share note", exact: true });
  await sharing.getByLabel("Add people", { exact: true }).selectOption(peer.hqUserId);
  await sharing.getByRole("button", { name: "Save sharing", exact: true }).click();
  await expect(sharing).not.toBeVisible();
  const peerContext = await browser.newContext();
  await peerContext.addCookies(playwrightAuthCookies(peer));
  const reader = await peerContext.newPage();
  await reader.goto("/notes");
  await reader.getByRole("button", { name: /^Shared with me/ }).click();
  const sharedCard = reader.getByTestId("note-card").filter({ hasText: "Shared rally brief" });
  await expect(sharedCard).toBeVisible();
  await sharedCard.getByRole("button").first().click();
  const preview = reader.getByRole("dialog");
  await expect(preview).toContainText("Current shareable brief");
  await expect(preview).not.toContainText("Private strategy");
  await expect(preview.getByRole("button", { name: "Save note", exact: true })).toHaveCount(0);
  const history = await reader.request.get(`/api/notes/${noteId}/history`);
  expect(history.status()).toBe(404);
  const peerEdit = await reader.request.patch(`/api/notes/${noteId}`, { data: { expectedVersion: 3, body: "Not allowed" } });
  expect(peerEdit.status()).toBe(404);
  const state = await (await page.request.get(`/api/notes/${noteId}/sharing`)).json();
  const revoked = await page.request.put(`/api/notes/${noteId}/sharing`, { data: { expectedVersion: state.version, grants: [] } });
  expect(revoked.status()).toBe(200);
  await reader.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(preview).not.toBeVisible();
  await expect(reader.getByTestId("note-card")).toHaveCount(0);
  await peerContext.close();
});

test("keeps an authorized draft when its note is outside the refreshed list window", async ({ page }) => {
  const { author } = await fixture();
  await page.context().addCookies(playwrightAuthCookies(author));
  const created = await page.request.post("/api/notes", { data: { title: "Windowed note", body: "Original text" } });
  expect(created.status()).toBe(200);
  const { noteId } = await created.json();
  const listing = await (await page.request.get("/api/notes?format=summary")).json();
  await page.goto(`/notes/${noteId}`);
  const editor = page.getByRole("dialog");
  await editor.getByRole("button", { name: "Write", exact: true }).click();
  await editor.locator("textarea").first().fill("Unsaved authorized correction");
  expect(listing.items).toHaveLength(1);
  let intercepted = 0;
  await page.route((url) => url.pathname === "/api/notes" && url.searchParams.get("format") === "summary", (route) => { intercepted++; return route.fulfill({ json: { ...listing, items: [] } }); });
  const checked = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/notes/${noteId}` && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => intercepted).toBeGreaterThan(0);
  expect((await checked).status()).toBe(200);
  await expect(editor).toBeVisible();
  await expect(editor.locator("textarea").first()).toHaveValue("Unsaved authorized correction");
});

test("keeps stale edits from overwriting a saved note and rejects cross-alliance member associations atomically", async ({ request }) => {
  const { author } = await fixture();
  const other = await fixture();
  const headers = { Cookie: authCookieHeader(author) };
  const created = await request.post("/api/notes", { headers, data: { title: "Version safety", body: "Original" } });
  expect(created.status()).toBe(200);
  const { noteId, notes } = await created.json();
  const version = notes.find((note: { id: string }) => note.id === noteId).version;
  const first = await request.patch(`/api/notes/${noteId}`, { headers, data: { expectedVersion: version, body: "Saved update" } });
  expect(first.status()).toBe(200);
  const stale = await request.patch(`/api/notes/${noteId}`, { headers, data: { expectedVersion: version, body: "Stale overwrite" } });
  expect(stale.status()).toBe(409);
  const invalid = await request.post("/api/notes", { headers, data: { title: "Must roll back", body: "Not saved", memberIds: [other.cookie.ashedMemberId] } });
  expect(invalid.status()).toBe(400);
  const listed = await (await request.get("/api/notes", { headers })).json();
  expect(listed.notes.some((note: { title: string }) => note.title === "Must roll back")).toBe(false);
  const current = await (await request.get(`/api/notes/${noteId}`, { headers })).json();
  expect(current.note.body).toBe("Saved update");
  expect(current.note.title).toBe("Version safety");
  const history = await (await request.get(`/api/notes/${noteId}/history`, { headers })).json();
  expect(history.revisions).toHaveLength(1);
  expect(history.revisions[0].snapshot.body).toBe("Original");
  const restored = await request.patch(`/api/notes/${noteId}`, { headers, data: { ...history.revisions[0].snapshot, expectedVersion: current.note.version } });
  expect(restored.status()).toBe(200);
  expect((await restored.json()).note.body).toBe("Original");
  const retained = await (await request.get(`/api/notes/${noteId}/history`, { headers })).json();
  expect(retained.revisions).toHaveLength(2);
});

test("supports localized capture and page-scoped keyboard actions", async ({ page }) => {
  const { author } = await fixture();
  await page.context().addCookies(playwrightAuthCookies(author));
  await page.goto("/pt-BR/notes");
  await expect(page.getByRole("heading", { name: "Notas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nova nota", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).last().click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.keyboard.press("Alt+n");
  const dialog = page.getByRole("dialog", { name: "Nova nota", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Título", { exact: true }).fill("Registro da aliança");
  await dialog.getByLabel("Nota", { exact: true }).fill("Uma observação para consultar depois.");
  await dialog.getByRole("button", { name: "Salvar nota", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("note-card")).toContainText("Registro da aliança");
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Buscar nas suas notas…", exact: true })).toBeFocused();
});
