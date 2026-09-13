import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { createNotesFixture } from "./fixtures/notes";
import { authCookieHeader, createAllianceMembership, getE2eSql, playwrightAuthCookies } from "./fixtures/db";

test("officer boards synchronize through SSE, preserve source privacy, and revoke live access", async ({ request, browser }) => {
  const { author, peer, alliance } = await createNotesFixture("officer");
  const headers = { Cookie: authCookieHeader(author) };
  const peerHeaders = { Cookie: authCookieHeader(peer) };
  const created = await request.post("/api/notes/boards", { headers, data: { name: "Operations board", requestId: nanoid() } });
  expect(created.status(), await created.text()).toBe(200);
  const { boardId } = await created.json();
  const capture = await request.post("/api/notes/capture", { headers, data: { requestId: nanoid(), title: "Private source title", body: "Private source detail not for this board", tasks: [{ title: "Review coverage", actionKey: "coverage", included: true, evidence: null, priority: null }] } });
  expect(capture.status(), await capture.text()).toBe(200);
  const saved = await capture.json();
  const taskId = saved.taskIds[0];
  const shared = await request.post(`/api/notes/boards/${boardId}/commands`, { headers, data: { kind: "share", requestId: nanoid(), expectedVersion: 1, taskId, expectedTaskVersion: 1 } });
  expect(shared.status(), await shared.text()).toBe(200);
  let snapshot = await (await request.get(`/api/notes/boards/${boardId}`, { headers: peerHeaders })).json();
  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0].source).toBeNull();
  expect(JSON.stringify(snapshot).includes("Private source")).toBe(false);
  const sourceUpdate = await request.patch(`/api/notes/${saved.noteId}`, { headers, data: { expectedVersion: saved.note.version, body: "Still private, never copied into board events" } });
  expect(sourceUpdate.status()).toBe(200);
  expect((await (await request.get(`/api/notes/boards/${boardId}`, { headers })).json()).version).toBe(snapshot.version);

  const a = await browser.newContext(); const b = await browser.newContext();
  await a.addCookies(playwrightAuthCookies(author)); await b.addCookies(playwrightAuthCookies(peer));
  const pageA = await a.newPage(); const pageB = await b.newPage();
  try {
    await Promise.all([pageA.goto(`/notes?view=boards&board=${boardId}`), pageB.goto(`/notes?view=boards&board=${boardId}`)]);
    const boardA = pageA.getByTestId("notes-shared-board"); const boardB = pageB.getByTestId("notes-shared-board");
    await expect(boardA.getByRole("status")).toHaveText("Live");
    await expect(boardB.getByRole("status")).toHaveText("Live");
    await boardA.getByRole("button", { name: "New task", exact: true }).click();
    const creator = pageA.getByRole("dialog", { name: "New task", exact: true });
    await creator.getByLabel("Task title", { exact: true }).fill("Live added card");
    await creator.getByRole("button", { name: "Save to this board", exact: true }).click();
    await expect(creator).not.toBeVisible();
    await expect(boardB.getByRole("button", { name: "Live added card", exact: true })).toBeVisible({ timeout: 5_000 });
    snapshot = await (await request.get(`/api/notes/boards/${boardId}`, { headers })).json();
    const moved = await request.post(`/api/notes/boards/${boardId}/commands`, { headers, data: { kind: "move", requestId: nanoid(), expectedVersion: snapshot.version, taskId, expectedTaskVersion: snapshot.tasks[0].version, status: "in_progress" } });
    expect(moved.status(), await moved.text()).toBe(200);
    await expect(boardB.locator(`[data-task-id="${taskId}"]`).getByRole("button", { name: "Status", exact: true })).toContainText("In progress", { timeout: 5_000 });
    snapshot = await (await request.get(`/api/notes/boards/${boardId}`, { headers: peerHeaders })).json();
    const priority = await request.patch(`/api/notes/tasks/${taskId}`, { headers: peerHeaders, data: { expectedVersion: snapshot.tasks[0].version, priority: "urgent" } });
    expect(priority.status(), await priority.text()).toBe(200);
    await expect(boardA.locator(`[data-task-id="${taskId}"]`).getByRole("button", { name: "Priority", exact: true })).toContainText("Urgent", { timeout: 5_000 });
    snapshot = await (await request.get(`/api/notes/boards/${boardId}`, { headers: peerHeaders })).json();
    const renamed = await request.post(`/api/notes/boards/${boardId}/commands`, { headers: peerHeaders, data: { kind: "rename", requestId: nanoid(), expectedVersion: snapshot.version, name: "Live operations" } });
    expect(renamed.status(), await renamed.text()).toBe(200);
    await expect(boardA.getByTestId("notes-board-name")).toHaveText("Live operations", { timeout: 5_000 });
    await boardB.locator(`[data-task-id="${taskId}"]`).getByRole("button", { name: "Review coverage", exact: true }).click();
    const editor = pageB.getByRole("dialog", { name: "Task details", exact: true });
    await editor.getByLabel("Task title", { exact: true }).fill("Unsaved peer title");
    snapshot = await (await request.get(`/api/notes/boards/${boardId}`, { headers })).json();
    const title = await request.patch(`/api/notes/tasks/${taskId}`, { headers, data: { expectedVersion: snapshot.tasks[0].version, title: "Committed owner title", priority: "low" } });
    expect(title.status()).toBe(200);
    await expect(boardB.locator(`[data-task-id="${taskId}"]`)).toContainText("Committed owner title", { timeout: 5_000 });
    await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue("Unsaved peer title");
    await editor.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
    await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue("Unsaved peer title");
    await editor.getByRole("button", { name: "Review latest task", exact: true }).click();
    await expect(editor.getByRole("region", { name: "Latest saved task", exact: true })).toContainText("Committed owner title");
    await editor.getByRole("button", { name: "Keep my changes", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Priority", exact: true })).toContainText("Low");
    await editor.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(boardA.locator(`[data-task-id="${taskId}"]`)).toContainText("Unsaved peer title", { timeout: 5_000 });
    expect((await (await request.get(`/api/notes/tasks/${taskId}`, { headers })).json()).task.priority).toBe("low");

    const sql = getE2eSql();
    await sql`UPDATE alliance_memberships SET role_id = (SELECT id FROM roles WHERE name = 'viewer' LIMIT 1) WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${peer.hqUserId}`;
    snapshot = await (await request.get(`/api/notes/boards/${boardId}`, { headers })).json();
    const invalidate = await request.post(`/api/notes/boards/${boardId}/commands`, { headers, data: { kind: "rename", requestId: nanoid(), expectedVersion: snapshot.version, name: "Officers only after revocation" } });
    expect(invalidate.status()).toBe(200);
    await expect(pageB.getByTestId("notes-shared-board")).toHaveCount(0, { timeout: 5_000 });
    await expect(pageB.getByRole("dialog")).toHaveCount(0);
    expect((await request.get(`/api/notes/boards/${boardId}`, { headers: peerHeaders })).status()).toBe(403);
    expect((await request.get(`/api/events/notes/boards/${boardId}`, { headers: peerHeaders })).status()).toBe(403);
    expect((await request.get(`/api/notes/tasks/${taskId}`, { headers: peerHeaders })).status()).toBe(404);
  } finally { await a.close(); await b.close(); }
});

test("board ordering, command receipts, and concurrent edits are durable", async ({ request }) => {
  const { author, peer } = await createNotesFixture("officer");
  const headers = { Cookie: authCookieHeader(author) };
  const board = await (await request.post("/api/notes/boards", { headers, data: { name: "Ordering", requestId: nanoid() } })).json();
  for (const [index, title] of ["First", "Second"].entries()) {
    const result = await request.post(`/api/notes/boards/${board.boardId}/commands`, { headers, data: { kind: "create", requestId: nanoid(), expectedVersion: index + 1, task: { title, assigneeHqUserId: index === 1 ? peer.hqUserId : null } } });
    expect(result.status(), await result.text()).toBe(200);
  }
  let snapshot = await (await request.get(`/api/notes/boards/${board.boardId}`, { headers })).json();
  const [first, second] = snapshot.tasks;
  const command = { kind: "move", requestId: nanoid(), expectedVersion: snapshot.version, taskId: second.id, expectedTaskVersion: second.version, status: "open", beforeTaskId: first.id };
  const moved = await request.post(`/api/notes/boards/${board.boardId}/commands`, { headers, data: command });
  expect(moved.status(), await moved.text()).toBe(200);
  const replayed = await request.post(`/api/notes/boards/${board.boardId}/commands`, { headers, data: command });
  expect(replayed.status()).toBe(200);
  expect((await replayed.json()).version).toBe((await moved.json()).version);
  snapshot = await (await request.get(`/api/notes/boards/${board.boardId}`, { headers })).json();
  expect(snapshot.tasks.map((task: { id: string }) => task.id)).toEqual([second.id, first.id]);
  const race = await Promise.all([headers, { Cookie: authCookieHeader(peer) }].map((headers, index) => request.post(`/api/notes/boards/${board.boardId}/commands`, { headers, data: { kind: "rename", requestId: nanoid(), expectedVersion: snapshot.version, name: `Winner ${index}` } })));
  expect(race.map((response) => response.status()).sort()).toEqual([200, 409]);
});

test("individual task grants do not grant boards, and owner removal preserves the task", async ({ request }) => {
  const { author, peer, alliance } = await createNotesFixture("officer");
  const outsider = await createNotesFixture();
  const viewer = outsider.peer;
  const sql = getE2eSql();
  await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: viewer.hqUserId, roleName: "viewer", source: "manual" });
  await sql`UPDATE sessions SET current_alliance_id = ${alliance.allianceId} WHERE id = ${viewer.sessionId}`;
  const headers = { Cookie: authCookieHeader(author) }; const peerHeaders = { Cookie: authCookieHeader(peer) }; const viewerHeaders = { Cookie: authCookieHeader(viewer) };
  const board = await (await request.post("/api/notes/boards", { headers, data: { name: "Protected", requestId: nanoid() } })).json();
  const taskResponse = await request.post("/api/notes/tasks", { headers, data: { title: "Shared card" } });
  const { task } = await taskResponse.json();
  const taskShare = await request.put(`/api/notes/tasks/${task.id}/sharing`, { headers, data: { expectedVersion: task.version, grants: [{ subjectKind: "user", subjectId: viewer.hqUserId, role: "read" }] } });
  expect(taskShare.status()).toBe(200);
  const shared = await request.post(`/api/notes/boards/${board.boardId}/commands`, { headers, data: { kind: "share", requestId: nanoid(), expectedVersion: 1, taskId: task.id, expectedTaskVersion: 2 } });
  expect(shared.status(), await shared.text()).toBe(200);
  expect((await request.get(`/api/notes/tasks/${task.id}`, { headers: viewerHeaders })).status()).toBe(200);
  for (const path of ["/api/notes/boards", `/api/notes/boards/${board.boardId}`, `/api/events/notes/boards/${board.boardId}`]) {
    expect((await request.get(path, { headers: viewerHeaders })).status()).toBe(403);
    expect((await request.get(path)).status()).toBe(401);
  }
  await sql`UPDATE alliance_memberships SET role_id = (SELECT id FROM roles WHERE name = 'data_entry' LIMIT 1) WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${viewer.hqUserId}`;
  expect((await request.get(`/api/notes/boards/${board.boardId}`, { headers: viewerHeaders })).status()).toBe(403);
  const foreignHeaders = { Cookie: authCookieHeader(outsider.author) };
  expect((await request.get(`/api/notes/boards/${board.boardId}`, { headers: foreignHeaders })).status()).toBe(404);
  expect((await request.get(`/api/events/notes/boards/${board.boardId}`, { headers: foreignHeaders })).status()).toBe(404);
  let snapshot = await (await request.get(`/api/notes/boards/${board.boardId}`, { headers })).json();
  const peerRemove = await request.post(`/api/notes/boards/${board.boardId}/commands`, { headers: peerHeaders, data: { kind: "remove", requestId: nanoid(), expectedVersion: snapshot.version, taskId: task.id, expectedTaskVersion: snapshot.tasks[0].version } });
  expect(peerRemove.status()).toBe(404);
  const remove = await request.post(`/api/notes/boards/${board.boardId}/commands`, { headers, data: { kind: "remove", requestId: nanoid(), expectedVersion: snapshot.version, taskId: task.id, expectedTaskVersion: snapshot.tasks[0].version } });
  expect(remove.status(), await remove.text()).toBe(200);
  snapshot = await (await request.get(`/api/notes/boards/${board.boardId}`, { headers: peerHeaders })).json();
  expect(snapshot.tasks).toHaveLength(0);
  expect((await request.get(`/api/notes/tasks/${task.id}`, { headers: peerHeaders })).status()).toBe(404);
  expect((await request.get(`/api/notes/tasks/${task.id}`, { headers: viewerHeaders })).status()).toBe(200);
});
