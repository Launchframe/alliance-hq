import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { nanoid } from "nanoid";
import { playwrightAuthCookies } from "./fixtures/auth";
import { authCookieHeader, type SessionFixture } from "./fixtures/db";
import { createPublishedSupportTeamFixture } from "./fixtures/support-teams";

async function command(request: APIRequestContext, actor: SessionFixture, operation: Record<string, unknown>) {
  const headers = { Cookie: authCookieHeader(actor) };
  const snapshot = await (await request.get("/api/support-teams", { headers })).json();
  const response = await request.post("/api/support-teams", { headers, data: { command: { ...operation, expectedVersion: snapshot.version }, idempotencyKey: nanoid() } });
  expect(response.status()).toBe(200);
  return (await response.json()).event;
}
async function history(page: Page, actor: SessionFixture) {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto("/support-teams");
  await page.getByRole("button", { name: "Team-builder history", exact: true }).click();
  return page.getByRole("dialog", { name: "Team-builder history", exact: true });
}

test("officer UI undoes an older own move while preserving unrelated history", async ({ page, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  const root = await command(request, f.officer, { kind: "move", memberId: f.members[0].ashedMemberId, from: null, to: f.teams[0] });
  await command(request, f.owner, { kind: "rename", teamId: f.teams[1], name: "Unrelated harbor" });
  const timeline = await history(page, f.officer);
  const row = timeline.getByRole("listitem").filter({ hasText: "Officer fixture moved Member 0" });
  await row.getByRole("button", { name: "Preview undo", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview undo", exact: true });
  await expect(preview.getByText("Officer fixture moved Member 0 from Unsorted to Cedar.", { exact: true }).first()).toBeVisible();
  let payload: Record<string, unknown> | undefined;
  page.on("request", (req) => { if (new URL(req.url()).pathname.endsWith("/undo")) payload = req.postDataJSON(); });
  await preview.getByRole("button", { name: "Undo 1 actions", exact: true }).click();
  await expect(preview).not.toBeVisible();
  expect(payload).toMatchObject({ actionIds: [root.id], idempotencyKey: expect.any(String), expectedVersions: expect.any(Object) });
  expect(payload).not.toHaveProperty("patches");
  await expect(timeline.getByText("Action reversed and recorded in history.", { exact: true }).first()).toBeVisible();
  const snapshot = await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(f.officer) } })).json();
  expect(snapshot.teams.find((team: { id: string }) => team.id === f.teams[1]).name).toBe("Unrelated harbor");
  expect(snapshot.teams.flatMap((team: { memberIds: string[] }) => team.memberIds)).not.toContain(f.members[0].ashedMemberId);
  const [original] = await f.sql`SELECT event FROM support_team_events WHERE id = ${root.id}`;
  expect(original.event.reverses).toEqual([]);
});

test("mobile officer sees dependency block; owner cascade stays open on stale confirmation", async ({ browser, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  await command(request, f.officer, { kind: "move", memberId: f.members[0].ashedMemberId, from: null, to: f.teams[0] });
  await command(request, f.owner, { kind: "move", memberId: f.members[0].ashedMemberId, from: f.teams[0], to: f.teams[1] });
  const officerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ownerContext = await browser.newContext();
  try {
    const officerPage = await officerContext.newPage();
    const officerHistory = await history(officerPage, f.officer);
    const officerRow = officerHistory.getByRole("listitem").filter({ hasText: "Officer fixture moved Member 0" });
    await expect(officerRow.getByRole("alert")).toContainText("Later actions depend on this change.");
    await officerRow.getByRole("button", { name: "Preview undo", exact: true }).click();
    const blocked = officerPage.getByRole("dialog", { name: "Preview undo", exact: true });
    await expect(blocked.getByRole("alert")).toContainText("Later actions depend on this change.");
    await expect(blocked.getByRole("button", { name: /Undo .* actions/ })).toHaveCount(0);
    const ownerPage = await ownerContext.newPage();
    const ownerHistory = await history(ownerPage, f.owner);
    await ownerHistory.getByRole("listitem").filter({ hasText: "Officer fixture moved Member 0" }).getByRole("button", { name: "Preview undo", exact: true }).click();
    const preview = ownerPage.getByRole("dialog", { name: "Preview undo", exact: true });
    await expect(preview.getByRole("button", { name: "Undo 2 actions", exact: true })).toBeVisible();
    await expect(preview.getByText("Owner fixture moved Member 0 from Cedar to Harbor.", { exact: true })).toBeVisible();
    await command(request, f.owner, { kind: "move", memberId: f.members[0].ashedMemberId, from: f.teams[1], to: f.teams[0] });
    await preview.getByRole("button", { name: "Undo 2 actions", exact: true }).click();
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("alert")).toContainText("This action or its dependencies changed.");
    await preview.getByRole("button", { name: "Preview undo", exact: true }).click();
    await expect(preview.getByRole("button", { name: "Undo 3 actions", exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Undo 3 actions", exact: true }).click();
    await expect(preview).not.toBeVisible();
  } finally { await officerContext.close(); await ownerContext.close(); }
});
