import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { playwrightAuthCookies } from "./fixtures/auth";
import { createHqMemberLink } from "./fixtures/db";
import en from "../messages/en-US.json";
import pt from "../messages/pt-BR.json";
import { authCookieHeader, createBrowserSession, type SessionFixture } from "./fixtures/db";
import { createSupportTeamFixture } from "./fixtures/support-teams";
import type { ProposalSnapshot } from "../src/lib/support-teams/proposal.shared";

async function openProposal(page: Page, actor: SessionFixture, id?: string, locale = "en-US") {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto(`${locale === "pt-BR" ? "/pt-BR" : ""}/support-teams${id ? `?proposal=${id}` : ""}`);
}
async function refreshProposal(page: Page, path: string) {
  const refreshed = page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
}

async function proposal(request: APIRequestContext, prepare?: (fixture: Awaited<ReturnType<typeof createSupportTeamFixture>>) => Promise<void>) {
  const f = await createSupportTeamFixture();
  await f.sql`UPDATE alliance_members SET alliance_rank = 4 WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.leads[1].ashedMemberId}`;
  await f.sql`UPDATE hq_member_links SET ashed_member_id = ${f.members[5].ashedMemberId} WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.leads[1].ashedMemberId}`;
  await prepare?.(f);
  const headers = (actor: SessionFixture) => ({ Cookie: authCookieHeader(actor) });
  const input = { expectedVersion: 0, idempotencyKey: randomUUID() };
  const created = await request.post("/api/support-teams/proposals", { headers: headers(f.officer), data: input });
  expect(created.status()).toBe(200);
  const { proposalId, event } = await created.json();
  const path = `/api/support-teams/proposals/${proposalId}`;
  const snapshot = async (actor = f.officer): Promise<ProposalSnapshot> => {
    const response = await request.get(path, { headers: headers(actor) });
    expect(response.status()).toBe(200); return response.json();
  };
  const post = async (action: string, body: Record<string, unknown> = {}, actor = f.officer) => request.post(`${path}/${action}`, { headers: headers(actor), data: { expectedVersion: (await snapshot(actor)).proposalVersion, idempotencyKey: randomUUID(), ...body } });
  const fill = async () => {
    for (const member of f.members) {
      const view = await snapshot(); const team = view.teams.find((t) => t.memberIds.length < t.target)!;
      expect((await post("move", { memberId: member.ashedMemberId, from: null, to: team.id })).status()).toBe(200);
    }
    expect((await post("submit")).status()).toBe(200);
  };
  return { ...f, headers, input, proposalId, event, path, snapshot, post, fill };
}

for (const [locale, messages] of [["en-US", en], ["pt-BR", pt]] as const) {
  test(`browser freehand create, drag, search, mobile allocation, approval, publication and owner undo (${locale})`, async ({ page, context, browser, request }) => {
    const f = await createSupportTeamFixture();
    const copy = messages.supportTeams;
    const member = await f.actor("member");
    await createHqMemberLink(f.sql, { allianceId: f.allianceId, hqUserId: member.hqUserId, ashedMemberId: f.members[0].ashedMemberId, gameUid: `96${Date.now()}` });
    await page.setViewportSize({ width: 1500, height: 1000 });
    await openProposal(page, f.officer, undefined, locale);
    const created = page.waitForResponse((response) => response.url().endsWith("/api/support-teams/proposals") && response.request().method() === "POST");
    await page.getByRole("button", { name: copy.proposals.create, exact: true }).click();
    const creation = await (await created).json();
    const path = `/api/support-teams/proposals/${creation.proposalId}`;
    await expect(page).toHaveURL(new RegExp(`proposal=${creation.proposalId}`));
    const read = async (): Promise<ProposalSnapshot> => (await request.get(path, { headers: { Cookie: authCookieHeader(f.officer) } })).json();
    const allocations: Record<string, unknown>[] = [];
    let liveWrites = 0;
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      if (new URL(req.url()).pathname === "/api/support-teams") liveWrites++;
      if (new URL(req.url()).pathname === `${path}/move`) allocations.push(req.postDataJSON());
    });
    for (const [index, member] of f.members.entries()) {
      const before = await read();
      const target = before.teams.find((team) => team.memberIds.length < team.target)!;
      const slot = page.locator(`[data-support-team="${target.id}"]`);
      const moved = page.waitForResponse((response) => response.url().endsWith(`${path}/move`) && response.request().method() === "POST");
      if (index === 0) {
        await page.locator(`[data-support-member="${member.ashedMemberId}"]`).dragTo(slot);
      } else if (index < f.members.length - 1) {
        const search = slot.getByRole("combobox", { name: copy.addMember, exact: true });
        await search.fill(`Member ${index}`);
        await page.getByRole("option", { name: new RegExp(`Member ${index}`) }).click();
      } else {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("combobox", { name: copy.findMember, exact: true }).fill(before.roster.find((row) => row.id === target.leadId)!.name);
        await page.getByRole("option", { name: new RegExp(before.roster.find((row) => row.id === target.leadId)!.name) }).click();
        await page.getByRole("button", { name: copy.openPool, exact: true }).click();
        const pool = page.getByRole("dialog", { name: copy.unsorted, exact: true });
        await pool.locator(`[data-support-member="${member.ashedMemberId}"]`).getByRole("button", { name: new RegExp(copy.addMember) }).click();
      }
      const response = await moved;
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(allocations.at(-1)).toMatchObject({ memberId: member.ashedMemberId, expectedVersion: before.proposalVersion, from: null, to: target.id });
      await expect.poll(async () => (await read()).version).toBeGreaterThanOrEqual(result.version);
      if (index === f.members.length - 1) await page.getByRole("button", { name: copy.closePool, exact: true }).click();
      await expect(slot.locator(`[data-support-member="${member.ashedMemberId}"]`)).toBeVisible();
    }
    expect(liveWrites).toBe(0);
    const publicContext = await browser.newContext();
    const ownerContext = await browser.newContext();
    try {
      const memberPage = await publicContext.newPage();
      const privateReads: string[] = [];
      memberPage.on("request", (req) => { if (/\/proposals|\/drafts|\/history/.test(new URL(req.url()).pathname)) privateReads.push(req.url()); });
      await openProposal(memberPage, member, creation.proposalId, locale);
      await expect(memberPage.getByRole("heading", { name: copy.proposals.title, exact: true })).toHaveCount(0);
      await expect(memberPage.getByRole("button", { name: copy.history.title, exact: true })).toHaveCount(0);
      await expect(memberPage.locator("[data-support-team]")).toHaveCount(0);
      expect(privateReads).toEqual([]);
      await page.getByRole("button", { name: copy.proposals.submit, exact: true }).click();
      await expect(page.getByRole("button", { name: copy.proposals.approve, exact: true })).toBeEnabled();
      const approved = page.waitForResponse((response) => response.url().endsWith(`${path}/approve`));
      await page.getByRole("button", { name: copy.proposals.approve, exact: true }).click();
      const vote = await (await approved).json();
      await expect(page.getByRole("button", { name: copy.proposals.publish, exact: true })).toBeEnabled();
      const published = page.waitForResponse((response) => response.url().endsWith(`${path}/publish`));
      await page.getByRole("button", { name: copy.proposals.publish, exact: true }).click();
      const publication = await (await published).json();
      expect(publication.event.context.ownerOverride).toBe(false);
      await expect(page.getByRole("button", { name: copy.proposals.submit, exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`proposal=${creation.proposalId}`));
      await memberPage.reload();
      await expect(memberPage.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`)).toBeVisible();
      expect(privateReads).toEqual([]);
      const owner = await ownerContext.newPage();
      await openProposal(owner, f.owner, creation.proposalId, locale);
      await owner.getByRole("button", { name: copy.history.title, exact: true }).click();
      const timeline = owner.getByRole("dialog", { name: copy.history.title, exact: true });
      await expect(timeline).not.toContainText(/proposalVoterIds|draftStintToken|approvalBasis|service:/);
      await timeline.locator(`[data-support-event="${vote.event.id}"]`).getByRole("button", { name: copy.history.preview, exact: true }).click();
      const preview = owner.getByRole("dialog", { name: copy.history.preview, exact: true });
      await expect(preview.locator(`[data-support-event="${publication.event.id}"]`)).toBeVisible();
      await expect(preview.getByRole("heading", { name: copy.history.cascade, exact: true })).toBeVisible();
      await preview.getByRole("button", { name: copy.history.confirm.replace("{count}", "2"), exact: true }).click();
      await expect(preview).not.toBeVisible();
      await expect(timeline.locator(`[data-support-event="${vote.event.id}"]`)).toContainText(copy.history.undone);
      expect((await read()).approved).toBe(0);
    } finally { await publicContext.close(); await ownerContext.close(); }
    expect(context.pages()).toContain(page);
  });
}

test("browser strict 50 percent and unlinked denominator block publication until explicit owner dialog", async ({ page, browser, request }) => {
  const f = await proposal(request);
  await f.fill();
  await openProposal(page, f.officer, f.proposalId);
  await page.getByRole("button", { name: en.supportTeams.proposals.approve, exact: true }).click();
  await expect(page.getByText("1 approvals; 2 required from 2 active R4s.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: en.supportTeams.proposals.override, exact: true })).toHaveCount(0);
  const ownerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    await openProposal(owner, f.owner, f.proposalId);
    await expect(owner.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeDisabled();
    await owner.getByRole("button", { name: en.supportTeams.proposals.override, exact: true }).click();
    const dialog = owner.getByRole("dialog", { name: en.supportTeams.proposals.override, exact: true });
    await expect(dialog.getByText(en.supportTeams.proposals.overrideConfirm, { exact: true })).toBeVisible();
    expect((await f.snapshot()).phase).toBe("submitted");
    const published = owner.waitForResponse((response) => response.url().endsWith(`${f.path}/publish`));
    await dialog.getByRole("button", { name: en.supportTeams.proposals.override, exact: true }).click();
    const result = await (await published).json();
    expect(result.event.context.ownerOverride).toBe(true);
    await expect(dialog).not.toBeVisible();
    await owner.getByRole("button", { name: en.supportTeams.history.title, exact: true }).click();
    await expect(owner.getByRole("dialog", { name: en.supportTeams.history.title, exact: true }).locator(`[data-support-event="${result.event.id}"]`)).toContainText(en.supportTeams.proposals.override);
  } finally { await ownerContext.close(); }
});

test("two browser edits invalidate votes without losing search, and competing publication retains stale workspaces", async ({ browser, request }) => {
  const f = await proposal(request);
  await f.sql`UPDATE alliance_members SET alliance_rank = 5 WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.leads[1].ashedMemberId}`;
  await f.fill();
  const first = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const second = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const a = await first.newPage(), b = await second.newPage();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  try {
    await openProposal(a, f.officer, f.proposalId);
    await openProposal(b, f.owner, f.proposalId);
    await a.getByRole("button", { name: en.supportTeams.proposals.approve, exact: true }).click();
    await expect(a.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeEnabled();
    const locator = a.getByRole("combobox", { name: en.supportTeams.findMember, exact: true });
    await locator.fill("Member 0");
    await a.getByRole("option", { name: /Member 0/ }).click();
    await expect(a.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`)).toBeFocused();
    const personalSearch = a.locator("aside[data-support-pool], aside [data-support-pool]").getByRole("searchbox");
    await personalSearch.fill("Member 5");
    await expect(personalSearch).toBeFocused();
    const view = await f.snapshot();
    const moving = f.members[0].ashedMemberId;
    const other = f.members.find((member) => view.memberLocations[member.ashedMemberId] !== view.memberLocations[moving])!;
    const card = b.locator(`[data-support-member="${moving}"]`);
    await card.getByRole("button", { name: en.supportTeams.swapMembers, exact: true }).click();
    const swap = card.getByRole("combobox", { name: en.supportTeams.swapMembers, exact: true });
    await swap.fill(view.roster.find((row) => row.id === other.ashedMemberId)!.name);
    await b.getByRole("option", { name: new RegExp(view.roster.find((row) => row.id === other.ashedMemberId)!.name) }).click();
    await expect(a.getByText(en.supportTeams.proposals.invalidated, { exact: true })).toBeVisible();
    await expect(a.getByText("0 approvals; 1 required from 1 active R4s.", { exact: true })).toBeVisible();
    await expect(locator).toHaveValue("Member 0");
    await expect(personalSearch).toHaveValue("Member 5");
    await expect(personalSearch).toBeFocused();
    await expect(a.locator("[data-support-team]")).toHaveCount(2);
    await expect(a.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeDisabled();
    await a.getByRole("button", { name: en.supportTeams.proposals.submit, exact: true }).click();
    await a.getByRole("button", { name: en.supportTeams.proposals.approve, exact: true }).click();
    await expect(a.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeEnabled();
    const created = b.waitForResponse((response) => response.url().endsWith("/api/support-teams/proposals") && response.request().method() === "POST");
    await b.getByRole("button", { name: en.supportTeams.proposals.create, exact: true }).click();
    const id = (await (await created).json()).proposalId;
    const path = `/api/support-teams/proposals/${id}`;
    const read = async (): Promise<ProposalSnapshot> => (await request.get(path, { headers: f.headers(f.owner) })).json();
    for (const member of f.members) {
      const current = await read();
      const target = current.teams.find((team) => team.memberIds.length < team.target)!;
      expect((await request.post(`${path}/move`, { headers: f.headers(f.owner), data: { expectedVersion: current.proposalVersion, memberId: member.ashedMemberId, from: null, to: target.id, idempotencyKey: randomUUID() } })).status()).toBe(200);
    }
    await refreshProposal(b, path);
    await b.getByRole("button", { name: en.supportTeams.proposals.submit, exact: true }).click();
    await b.getByRole("button", { name: en.supportTeams.proposals.override, exact: true }).click();
    const dialog = b.getByRole("dialog", { name: en.supportTeams.proposals.override, exact: true });
    let arrived!: () => void;
    const intercepted = new Promise<void>((resolve) => { arrived = resolve; });
    await b.route(`**${path}/publish`, async (route) => { arrived(); await held; await route.continue(); });
    const conflict = b.waitForResponse((response) => response.url().endsWith(`${path}/publish`));
    await dialog.getByRole("button", { name: en.supportTeams.proposals.override, exact: true }).click();
    await intercepted;
    const publication = a.waitForResponse((response) => response.url().endsWith(`${f.path}/publish`));
    await a.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true }).click();
    expect((await publication).status()).toBe(200);
    release();
    expect((await conflict).status()).toBe(409);
    await expect(b.getByRole("alert").filter({ hasText: "The team plan changed." }).first()).toBeVisible();
    await expect(b).toHaveURL(new RegExp(`proposal=${id}`));
    expect(await read()).toMatchObject({ stale: true, canPublish: false, canOverride: false, phase: "submitted" });
    const list = await (await request.get("/api/support-teams/proposals", { headers: f.headers(f.owner) })).json();
    expect(list.proposals.map((item: ProposalSnapshot) => item.id)).toEqual(expect.arrayContaining([id, f.proposalId]));
    await b.reload();
    await expect(b).toHaveURL(new RegExp(`proposal=${id}`));
    await expect(b.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeDisabled();
    await expect(b.locator("[data-support-team]")).toHaveCount(2);
    await b.getByRole("button", { name: en.supportTeams.proposals.title, exact: true }).click();
    await b.getByRole("option", { name: new RegExp(en.supportTeams.proposals.publish) }).click();
    await expect(b).toHaveURL(new RegExp(`proposal=${f.proposalId}`));
    await expect(b.getByRole("button", { name: en.supportTeams.proposals.submit, exact: true })).toHaveCount(0);
    await b.getByRole("button", { name: en.supportTeams.proposals.title, exact: true }).click();
    await b.getByRole("option", { name: new RegExp(en.supportTeams.proposals.submit) }).click();
    await expect(b).toHaveURL(new RegExp(`proposal=${id}`));
    await expect(b.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeDisabled();
    await b.getByRole("button", { name: en.supportTeams.proposals.title, exact: true }).click();
    await b.getByRole("option", { name: en.supportTeams.title, exact: true }).click();
    await expect(b).not.toHaveURL(/proposal=/);
    await expect(b.getByRole("button", { name: en.supportTeams.proposals.submit, exact: true })).toHaveCount(0);
    await expect(b.locator("[data-support-team]")).toHaveCount(2);
    await b.evaluate((proposalId) => {
      const url = new URL(window.location.href);
      url.searchParams.set("proposal", proposalId);
      window.history.pushState(null, "", url);
    }, id);
    await expect(b.getByRole("button", { name: en.supportTeams.proposals.publish, exact: true })).toBeDisabled();
    await expect(b.locator("[data-support-team]")).toHaveCount(2);
  } finally {
    release();
    await b.unrouteAll({ behavior: "wait" });
    await Promise.all([a.goto("about:blank"), b.goto("about:blank")]);
    await Promise.all([first.close(), second.close()]);
  }
});

test("freehand keeps unlinked R4s in the strict-majority denominator and requires an explicit owner override", async ({ request }) => {
  const f = await proposal(request); await f.fill();
  expect((await f.post("approve")).status()).toBe(200);
  const view = await f.snapshot(f.owner);
  expect(view).toMatchObject({ electorateCount: 2, required: 2, approved: 1, canPublish: false, canOverride: true });
  expect((await f.post("publish", { override: false, expectedPublishedVersion: view.publishedVersion }, f.owner)).status()).toBe(403);
  expect((await f.post("publish", { override: true, expectedPublishedVersion: view.publishedVersion })).status()).toBe(403);
  expect((await f.post("publish", { expectedPublishedVersion: view.publishedVersion }, f.owner)).status()).toBe(400);
  const data = { expectedVersion: view.proposalVersion, expectedPublishedVersion: view.publishedVersion, override: true, idempotencyKey: randomUUID() };
  const results = await Promise.all([1, 2].map(() => request.post(`${f.path}/publish`, { headers: f.headers(f.owner), data })));
  expect(results.map((r) => r.status())).toEqual([200, 200]);
  expect((await results[0].json()).event.context.ownerOverride).toBe(true);
  const publicView = await (await request.get("/api/support-teams", { headers: f.headers(f.owner) })).json();
  expect(publicView.teams.flatMap((team: { memberIds: string[] }) => team.memberIds)).toHaveLength(8);
  expect(JSON.stringify(await f.snapshot())).not.toMatch(/proposalVoterIds|proposalIdentityToken|draftStintToken|gameUid|game_uid|approvalBasis/);
  const replay = await request.post("/api/support-teams/proposals", { headers: f.headers(f.officer), data: f.input });
  expect(replay.status()).toBe(200); expect((await replay.json()).proposalId).toBe(f.proposalId);
});

test("proposal construction forbids live-allocation bypasses, stale sources and cross-tenant or bootstrap access", async ({ request }) => {
  const f = await proposal(request);
  const bootstrap = await createBrowserSession(f.sql, { hqUserId: null });
  await f.sql`UPDATE sessions SET current_alliance_id = ${f.allianceId} WHERE id = ${bootstrap.sessionId}`;
  for (const [actor, status] of [[await f.actor("member"), 403], [await f.actor("data_entry"), 403], [(await createSupportTeamFixture()).owner, 409]] as const) {
    expect((await request.post(`${f.path}/submit`, { headers: f.headers(actor), data: { expectedVersion: 1, idempotencyKey: randomUUID() } })).status()).toBe(status);
    expect((await request.get(f.path, { headers: f.headers(actor) })).status()).toBe(status);
  }
  expect((await request.post(`${f.path}/submit`, { headers: { Cookie: `alliance_hq_session=${bootstrap.sessionId}` }, data: { expectedVersion: 1, idempotencyKey: randomUUID() } })).status()).toBe(403);
  const view = await f.snapshot();
  const memberId = f.members[0].ashedMemberId;
  const data = { expectedVersion: view.proposalVersion, memberId, from: null, to: view.teams[0].id };
  const race = await Promise.all([1, 2].map(() => f.post("move", { ...data, idempotencyKey: randomUUID() })));
  expect(race.map((r) => r.status()).sort()).toEqual([200, 409]);
  const live = await request.post("/api/support-teams", { headers: f.headers(f.owner), data: { command: { kind: "move", memberId, from: null, to: view.teams[0].id, expectedVersion: (await f.snapshot()).version }, idempotencyKey: randomUUID() } });
  expect(live.status()).toBe(409);
  const [count] = await f.sql`SELECT count(*)::int AS count FROM support_team_fields WHERE alliance_id = ${f.allianceId} AND key LIKE '["member",%' AND value IS NOT NULL`;
  expect(count.count).toBe(0);
});

test("competing proposals cannot overwrite a publication and a rejoin cannot restore an old assignment", async ({ request }) => {
  const f = await proposal(request); await f.fill();
  const second = await request.post("/api/support-teams/proposals", { headers: f.headers(f.officer), data: { expectedVersion: (await f.snapshot()).version, idempotencyKey: randomUUID() } });
  expect(second.status()).toBe(200); const { proposalId } = await second.json();
  const returned = f.members[0].ashedMemberId;
  await f.sql`UPDATE alliance_members SET join_date = '2026-09-11' WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${returned}`;
  let view = await f.snapshot(); expect(view.memberLocations[returned]).toBeNull(); expect(view.invalidated).toBe(true);
  expect((await f.post("publish", { override: true, expectedPublishedVersion: view.publishedVersion }, f.owner)).status()).toBe(409);
  const target = view.teams.find((team) => team.memberIds.length < team.target)!;
  expect((await f.post("move", { memberId: returned, from: null, to: target.id })).status()).toBe(200);
  expect((await f.post("submit")).status()).toBe(200);
  view = await f.snapshot();
  expect((await f.post("publish", { override: true, expectedPublishedVersion: view.publishedVersion }, f.owner)).status()).toBe(200);
  const stale = await (await request.get(`/api/support-teams/proposals/${proposalId}`, { headers: f.headers(f.owner) })).json();
  expect(stale.stale).toBe(true); expect(stale.canPublish).toBe(false); expect(stale.canOverride).toBe(false);
});

test("one proven person gets one vote across sessions and commanders, with away R4s and changed proofs fenced", async ({ request }) => {
  const f = await proposal(request, async (f) => {
  const commanderId = randomUUID();
  await f.sql`INSERT INTO commanders (id, primary_name, primary_name_normalized, current_alliance_id, game_uid) VALUES (${commanderId}, 'Lead 1', 'lead 1', ${f.allianceId}, ${`95${Date.now()}`})`;
  await f.sql`INSERT INTO commander_alliance_memberships (id, commander_id, alliance_id, ashed_member_id, status) VALUES (${randomUUID()}, ${commanderId}, ${f.allianceId}, ${f.leads[1].ashedMemberId}, 'active')`;
  await f.sql`INSERT INTO hq_user_commanders (id, hq_user_id, commander_id, is_primary) VALUES (${randomUUID()}, ${f.officer.hqUserId}, ${commanderId}, true)`;
  });
  await f.sql`INSERT INTO member_time_off (id, alliance_id, ashed_member_id, member_name, start_date, end_date, global_absence, availability, entry_kind, activity_scope, source) VALUES (${randomUUID()}, ${f.allianceId}, ${f.leads[1].ashedMemberId}, 'Lead 1', CURRENT_DATE - 1, CURRENT_DATE + 1, true, 'full_away', 'planned', 'all', 'web')`;
  await f.fill();
  const approved = await f.post("approve");
  expect(approved.status()).toBe(200);
  const vote = (await approved.json()).event;
  const session = await createBrowserSession(f.sql, { hqUserId: f.officer.hqUserId });
  await f.sql`UPDATE sessions SET current_alliance_id = ${f.allianceId} WHERE id = ${session.sessionId}`;
  const otherSession = { ...f.officer, sessionId: session.sessionId };
  expect((await f.post("approve", {}, otherSession)).status()).toBe(409);
  expect(await f.snapshot()).toMatchObject({ electorateCount: 2, required: 2, approved: 1, canPublish: false });
  const undoPath = `/api/support-teams/history/${vote.id}`;
  const preview = await (await request.post(`${undoPath}/undo-preview`, { headers: f.headers(f.owner) })).json();
  const undone = await request.post(`${undoPath}/undo`, { headers: f.headers(f.owner), data: { actionIds: preview.actionIds, expectedVersions: preview.expectedVersions, idempotencyKey: randomUUID() } });
  expect(undone.status()).toBe(200);
  const reversal = (await undone.json()).event;
  expect((await f.snapshot()).approved).toBe(0);
  const redoPath = `/api/support-teams/history/${reversal.id}`;
  const redo = await (await request.post(`${redoPath}/undo-preview`, { headers: f.headers(f.owner) })).json();
  expect((await request.post(`${redoPath}/undo`, { headers: f.headers(f.owner), data: { actionIds: redo.actionIds, expectedVersions: redo.expectedVersions, idempotencyKey: randomUUID() } })).status()).toBe(200);
  expect((await f.snapshot()).approved).toBe(1);
  const [storedVote] = await f.sql`SELECT principal_id FROM support_team_events WHERE alliance_id = ${f.allianceId} AND id = ${vote.id}`;
  expect(storedVote.principal_id).toBe(f.officer.hqUserId);
  await f.sql`UPDATE hq_member_links SET linked_at = linked_at + interval '1 second' WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.leads[0].ashedMemberId}`;
  const changed = await f.snapshot();
  expect(changed).toMatchObject({ invalidated: true, approved: 0, canPublish: false });
  expect((await f.post("publish", { override: true, expectedPublishedVersion: changed.publishedVersion }, f.owner)).status()).toBe(409);
});

test("undo approval previews require owner review of dependent publication", async ({ request }) => {
  const f = await proposal(request);
  await f.sql`UPDATE alliance_members SET alliance_rank = 5 WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.leads[1].ashedMemberId}`;
  await f.fill();
  const vote = await (await f.post("approve")).json(); const view = await f.snapshot();
  const publication = await (await f.post("publish", { override: false, expectedPublishedVersion: view.publishedVersion })).json();
  const endpoint = `/api/support-teams/history/${vote.event.id}`;
  expect((await request.post(`${endpoint}/undo-preview`, { headers: f.headers(f.officer) })).status()).toBe(409);
  const previewResponse = await request.post(`${endpoint}/undo-preview`, { headers: f.headers(f.owner) });
  expect(previewResponse.status()).toBe(200); const preview = await previewResponse.json();
  expect(preview.actionIds).toContain(publication.event.id);
  const undone = await request.post(`${endpoint}/undo`, { headers: f.headers(f.owner), data: { actionIds: preview.actionIds, expectedVersions: preview.expectedVersions, idempotencyKey: randomUUID() } });
  expect(undone.status()).toBe(200);
  const [board] = await f.sql`SELECT published FROM support_team_boards WHERE alliance_id = ${f.allianceId}`;
  expect(board.published).toBe(false);
});
