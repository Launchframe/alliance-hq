import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authCookieHeader, createBrowserSession, type SessionFixture } from "./fixtures/db";
import { createSupportTeamFixture } from "./fixtures/support-teams";
import type { ProposalSnapshot } from "../src/lib/support-teams/proposal.shared";

async function proposal(request: APIRequestContext) {
  const f = await createSupportTeamFixture();
  await f.sql`UPDATE alliance_members SET alliance_rank = 4 WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${f.leads[1].ashedMemberId}`;
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
  for (const actor of [await f.actor("member"), await f.actor("data_entry"), (await createSupportTeamFixture()).owner]) {
    expect((await request.post(`${f.path}/submit`, { headers: f.headers(actor), data: { expectedVersion: 1, idempotencyKey: randomUUID() } })).status()).toBeGreaterThanOrEqual(400);
    expect((await request.get(f.path, { headers: f.headers(actor) })).status()).toBeGreaterThanOrEqual(400);
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
