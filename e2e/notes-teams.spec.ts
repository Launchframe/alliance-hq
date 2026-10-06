import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { nanoid } from "nanoid";
import { playwrightAuthCookies } from "./fixtures/auth";
import { authCookieHeader, type SessionFixture } from "./fixtures/db";
import { createSupportTeamFixture } from "./fixtures/support-teams";
import en from "../messages/en-US.json";

async function command(request: APIRequestContext, actor: SessionFixture, operation: Record<string, unknown>) {
  const headers = { Cookie: authCookieHeader(actor) };
  let response: Awaited<ReturnType<APIRequestContext["post"]>> | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await (await request.get("/api/support-teams", { headers })).json();
    const command = { ...operation, expectedVersion: snapshot.version };
    if (command.kind === "move") command.from = snapshot.teams.find((team: { memberIds: string[] }) => team.memberIds.includes(command.memberId))?.id ?? null;
    response = await request.post("/api/support-teams", { headers, data: { command, idempotencyKey: nanoid() } });
    if (response.ok()) return (await response.json()).event;
  }
  expect(response!.status(), await response!.text()).toBe(200);
}

async function openTeams(page: Page, actor: SessionFixture) {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto("/notes?view=teams");
  await expect(page.getByRole("button", { name: en.supportTeams.createTeam, exact: true }).or(page.locator("[data-member-board-scope]")).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: en.supportTeams.title, exact: true })).toBeVisible();
  await expect(page.getByText(en.supportTeams.subtitle, { exact: true })).toBeVisible();
}

test("owner creates named teams in Notes, assigns everyone to balanced targets, and publishes to members", async ({ page, request }) => {
  const f = await createSupportTeamFixture();
  await openTeams(page, f.owner);
  for (const index of f.leads.keys()) {
    await page.getByRole("button", { name: en.supportTeams.createTeam, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: en.supportTeams.createTeamTitle, exact: true });
    const teamName = index === 0 ? "Cedar" : "Harbor";
    await dialog.getByLabel(en.supportTeams.teamName, { exact: true }).pressSequentially(teamName);
    await expect(dialog.getByLabel(en.supportTeams.teamName, { exact: true })).toHaveValue(teamName);
    await dialog.getByRole("combobox", { name: en.supportTeams.teamLead, exact: true }).fill(`Lead ${index}`);
    await page.getByRole("option", { name: `Lead ${index}`, exact: true }).click();
    await dialog.getByRole("button", { name: en.supportTeams.createTeam, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  let teams: string[] = [];
  for (let attempt = 0; attempt < 10 && teams.length < 2; attempt++) {
    teams = (await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(f.owner) } })).json()).teams.map((team: { id: string }) => team.id);
    if (teams.length < 2) await page.waitForTimeout(300);
  }
  expect(teams).toHaveLength(2);
  for (const [index, member] of f.members.entries()) await command(request, f.owner, { kind: "move", memberId: member.ashedMemberId, from: null, to: teams[Math.floor(index / 3)] });
  await page.reload();
  await expect(page.getByText(en.supportTeams.assignmentProgress.replace("{assigned}", "8").replace("{total}", "8"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: en.supportTeams.publishTeams, exact: true }).click();
  const confirm = page.getByRole("dialog", { name: en.supportTeams.publishTitle, exact: true });
  await confirm.getByRole("button", { name: en.supportTeams.publishTeams, exact: true }).click();
  let published = false;
  for (let attempt = 0; attempt < 10 && !published; attempt++) {
    published = (await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(f.owner) } })).json()).published === true;
    if (!published) await page.waitForTimeout(300);
  }
  expect(published).toBe(true);
  await expect(page.getByRole("heading", { name: "Cedar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Harbor/ })).toBeVisible();

  const member = await f.actor("member");
  const projection = await request.get("/api/support-teams?bootstrap=1", { headers: { Cookie: authCookieHeader(member) } });
  expect(projection.status()).toBe(200);
  const body = await projection.json();
  expect(body.teams.map((team: { name: string }) => team.name).sort()).toEqual(["Cedar", "Harbor"]);
  expect(body.canWrite).toBe(false);
  expect((await request.post("/api/support-teams", { headers: { Cookie: authCookieHeader(member) }, data: { command: { kind: "publishSetup", expectedVersion: body.version }, idempotencyKey: nanoid() } })).status()).toBe(403);

  const stranger = await createSupportTeamFixture();
  const foreign = await request.get("/api/support-teams?bootstrap=1", { headers: { Cookie: authCookieHeader(stranger.owner) } });
  expect(foreign.status()).toBe(200);
  expect((await foreign.json()).teams).toHaveLength(0);
});

test("member card note actions create audience-scoped drafts and view notes applies the exact member filter", async ({ page, request }) => {
  const f = await createSupportTeamFixture();
  const memberId = f.members[0].ashedMemberId;
  for (const [index, teamId] of [`t-${nanoid(8)}`, `u-${nanoid(8)}`].entries()) {
    await command(request, f.owner, { kind: "createTeam", teamId, name: index === 0 ? "Cedar" : "Harbor", leadId: f.leads[index].ashedMemberId });
  }
  await openTeams(page, f.owner);
  const card = page.locator(`[data-support-member="${memberId}"]`);
  await expect(card.getByRole("button", { name: en.supportTeams.addNote, exact: true })).toBeVisible();

  await card.getByRole("button", { name: en.supportTeams.addNote, exact: true }).click();
  const audience = page.getByRole("dialog", { name: en.supportTeams.noteAudienceTitle.replace("{member}", "Member 0"), exact: true });
  await audience.getByRole("button", { name: en.supportTeams.noteAudienceOfficers, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New note", exact: true });
  await editor.getByLabel("Note", { exact: true }).fill("Officers should read this");
  await editor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const officerHeaders = { Cookie: authCookieHeader(f.officer) };
  const notes = await (await request.get("/api/notes", { headers: officerHeaders })).json();
  expect(notes.notes).toHaveLength(1);
  expect(notes.notes[0].members.map((member: { ashedMemberId: string }) => member.ashedMemberId)).toEqual([memberId]);
  const [grant] = await f.sql`
    SELECT kg.role, kr.access_version
    FROM knowledge_resource_grants kg
    JOIN knowledge_resources kr ON kr.id = kg.resource_id AND kr.alliance_id = kg.alliance_id
    WHERE kg.alliance_id = ${f.allianceId} AND kg.subject_kind = 'officers' AND kg.role = 'read'
  `;
  expect(grant).toMatchObject({ role: "read" });
  expect(Number(grant.access_version)).toBeGreaterThan(1);

  await page.goto("/notes?view=teams");
  const other = page.locator(`[data-support-member="${f.members[1].ashedMemberId}"]`);
  await other.getByRole("button", { name: en.supportTeams.addNote, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: en.supportTeams.noteAudiencePrivate, exact: true }).click();
  const privateEditor = page.getByRole("dialog", { name: "New note", exact: true });
  await privateEditor.getByLabel("Note", { exact: true }).fill("Private thought");
  await privateEditor.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(privateEditor).not.toBeVisible();
  expect((await (await request.get("/api/notes", { headers: officerHeaders })).json()).notes).toHaveLength(1);

  await page.goto("/notes?view=teams");
  await page.locator(`[data-support-member="${memberId}"]`).getByRole("button", { name: en.supportTeams.viewNotes, exact: true }).click();
  await expect(page).toHaveURL(/view=notebook/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("member")).toBe(memberId);
  expect(params.get("view")).toBe("notebook");
});

test("unprivileged sessions see no teams and cannot mutate the board", async ({ request }) => {
  const f = await createSupportTeamFixture();
  const viewer = await f.actor("viewer");
  const bootstrap = await request.get("/api/support-teams?bootstrap=1", { headers: { Cookie: authCookieHeader(viewer) } });
  expect(bootstrap.status()).toBe(200);
  const body = await bootstrap.json();
  expect(body.teams).toHaveLength(0);
  expect(body.canWrite).toBe(false);
  expect((await request.post("/api/support-teams", { headers: { Cookie: authCookieHeader(viewer) }, data: { command: { kind: "publishSetup", expectedVersion: body.version }, idempotencyKey: nanoid() } })).status()).toBe(403);
  expect((await request.get("/api/support-teams?bootstrap=1")).status()).toBeGreaterThanOrEqual(400);
});
