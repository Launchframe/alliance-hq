import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authCookieHeader, type SessionFixture } from "./fixtures/db";
import { createSupportTeamFixture } from "./fixtures/support-teams";
import type { DraftSnapshot } from "../src/lib/support-teams/draft.shared";

async function scheduled(request: APIRequestContext) {
  const f = await createSupportTeamFixture();
  const ownerHeaders = { Cookie: authCookieHeader(f.owner) };
  const officerHeaders = { Cookie: authCookieHeader(f.officer) };
  const idempotencyKey = randomUUID();
  const input = { expectedVersion: 0, startsAt: new Date(Date.now() + 2500).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), roundMinutes: 1, idempotencyKey };
  const response = await request.post("/api/support-teams/drafts", { headers: ownerHeaders, data: input });
  expect(response.status()).toBe(200);
  const { draftId } = await response.json();
  const path = `/api/support-teams/drafts/${draftId}`;
  const snapshot = async (actor = f.owner): Promise<DraftSnapshot> => {
    const result = await request.get(path, { headers: { Cookie: authCookieHeader(actor) } });
    expect(result.status()).toBe(200);
    return result.json();
  };
  const payload = (view: DraftSnapshot, teamId: string, memberId: string) => ({ teamId, memberId, expectedRound: view.currentRound, expectedRoundVersion: view.resourceVersions.round, expectedMemberVersion: view.resourceVersions.members[memberId], expectedSlotVersion: view.teams.find((team) => team.id === teamId)!.slotVersion, idempotencyKey: randomUUID() });
  const pick = (actor: SessionFixture, data: ReturnType<typeof payload>) => request.post(`${path}/pick`, { headers: { Cookie: authCookieHeader(actor) }, data });
  return { ...f, ownerHeaders, officerHeaders, input, path, draftId, snapshot, payload, pick };
}

test("draft preparation, concurrent independent picks and same-member race preserve published allocation", async ({ request }) => {
  const f = await scheduled(request);
  let view = await f.snapshot();
  const [a, b] = view.teams;
  const first = f.members[0].ashedMemberId;
  expect((await f.pick(f.owner, f.payload(view, a.id, first))).status()).toBe(409);
  const member = await f.actor("member");
  expect((await request.get(f.path, { headers: { Cookie: authCookieHeader(member) } })).status()).toBe(403);
  expect((await request.post(`${f.path}/cancel`, { headers: f.officerHeaders, data: { expectedVersion: view.version, idempotencyKey: randomUUID() } })).status()).toBe(403);
  expect((await request.post(`${f.path}/pick`, { data: f.payload(view, a.id, first) })).status()).toBe(403);
  await expect.poll(async () => (await f.snapshot()).phase).toBe("open");
  view = await f.snapshot();
  const same = await Promise.all([a, b].map((team) => f.pick(f.owner, f.payload(view, team.id, first))));
  expect(same.map((r) => r.status()).sort()).toEqual([200, 409]);
  const picked = await f.snapshot();
  const empty = picked.teams.find((team) => !team.picked)!;
  const second = await f.pick(f.owner, f.payload(view, empty.id, f.members[1].ashedMemberId));
  expect(second.status()).toBe(200);
  const response = await second.json();
  view = await f.snapshot();
  expect(view.currentRound).toBe(2);
  expect(response.version).toBe(response.event.boardVersion + 1);
  const publicView = await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(member) } })).json();
  expect(publicView.teams).toEqual([]);
  expect(publicView).not.toHaveProperty("board");
  const [count] = await f.sql`SELECT count(*)::int AS count FROM inbox_reminder_items WHERE alliance_id = ${f.allianceId} AND kind = 'support_team_draft' AND active = 1`;
  expect(count.count).toBe(1);
  const replay = await request.post("/api/support-teams/drafts", { headers: f.ownerHeaders, data: f.input });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).version).toBe(view.version);
});

test("draft proxy deadline, hard expiry, explicit extension, atomic partial publication and session revocation", async ({ request }) => {
  const f = await scheduled(request);
  await expect.poll(async () => (await f.snapshot()).phase).toBe("open");
  let view = await f.snapshot();
  const other = view.teams.find((team) => team.leadId !== f.leads[0].ashedMemberId)!;
  expect((await f.pick(f.officer, f.payload(view, other.id, f.members[0].ashedMemberId))).status()).toBe(409);
  const startedKey = JSON.stringify(["draft", f.draftId, "roundStartedAt"]);
  await f.sql`UPDATE support_team_fields SET value = to_jsonb((now() - interval '2 minutes')::text) WHERE alliance_id = ${f.allianceId} AND key = ${startedKey}`;
  expect((await f.pick(f.officer, f.payload(view, other.id, f.members[0].ashedMemberId))).status()).toBe(200);
  const endsKey = JSON.stringify(["draft", f.draftId, "endsAt"]);
  await f.sql`UPDATE support_team_fields SET value = to_jsonb((now() - interval '1 minute')::text) WHERE alliance_id = ${f.allianceId} AND key = ${endsKey}`;
  view = await f.snapshot();
  expect(view.phase).toBe("expired");
  const empty = view.teams.find((team) => !team.picked)!;
  expect((await f.pick(f.owner, f.payload(view, empty.id, f.members[1].ashedMemberId))).status()).toBe(409);
  expect((await request.post(`${f.path}/extend`, { headers: f.ownerHeaders, data: { endsAt: new Date(Date.now() + 7200000).toISOString(), expectedVersion: view.version, idempotencyKey: randomUUID() } })).status()).toBe(200);
  view = await f.snapshot();
  expect(view.phase).toBe("open");
  expect((await request.post(`${f.path}/publish`, { headers: f.ownerHeaders, data: { expectedVersion: view.version, allowUnsorted: false, idempotencyKey: randomUUID() } })).status()).toBe(409);
  const input = { expectedVersion: view.version, allowUnsorted: true, idempotencyKey: randomUUID() };
  const results = await Promise.all([1, 2].map(() => request.post(`${f.path}/publish`, { headers: f.ownerHeaders, data: input })));
  expect(results.map((r) => r.status())).toEqual([200, 200]);
  const publicView = await (await request.get("/api/support-teams", { headers: f.ownerHeaders })).json();
  expect(publicView.teams.flatMap((team: { memberIds: string[] }) => team.memberIds)).toHaveLength(3);
  await f.sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = ${f.officer.sessionId}`;
  expect((await request.post(`${f.path}/pick`, { headers: f.officerHeaders, data: f.payload(view, empty.id, f.members[1].ashedMemberId) })).status()).toBe(403);
});

test("draft automatic advance causality and reversal cycles preserve independent picks and immutable rows", async ({ request }) => {
  const f = await scheduled(request);
  await expect.poll(async () => (await f.snapshot()).phase).toBe("open");
  const view = await f.snapshot();
  const own = view.teams.find((team) => team.leadId === f.leads[0].ashedMemberId)!;
  const other = view.teams.find((team) => team.id !== own.id)!;
  const first = await (await f.pick(f.officer, f.payload(view, own.id, f.members[0].ashedMemberId))).json();
  const last = await (await f.pick(f.owner, f.payload(view, other.id, f.members[1].ashedMemberId))).json();
  const undo = async (id: string) => {
    const endpoint = `/api/support-teams/history/${id}`;
    const previewResponse = await request.post(`${endpoint}/undo-preview`, { headers: f.ownerHeaders });
    expect(previewResponse.status()).toBe(200);
    const preview = await previewResponse.json();
    const result = await request.post(`${endpoint}/undo`, { headers: f.ownerHeaders, data: { actionIds: preview.actionIds, expectedVersions: preview.expectedVersions, idempotencyKey: randomUUID() } });
    expect(result.status()).toBe(200);
    return result.json();
  };
  const reversed = await undo(first.event.id);
  expect(reversed.event.reverses).not.toContain(last.event.id);
  expect((await f.snapshot()).memberLocations[f.members[1].ashedMemberId]).toBe(other.id);
  await undo(reversed.event.id);
  const again = await undo(first.event.id);
  const [rows] = await f.sql`SELECT count(*)::int AS count FROM support_team_reversals WHERE alliance_id = ${f.allianceId} AND action_id = ${first.event.id}`;
  expect(rows.count).toBe(2);
  const history = await (await request.get("/api/support-teams/history", { headers: f.ownerHeaders })).json();
  expect(history.events.find((event: { id: string }) => event.id === first.event.id).reversalId).toBe(again.event.id);
  expect(history.events.find((event: { kind: string }) => event.kind === "advanceDraft")).toMatchObject({ principalType: "service", context: { sourceActionId: last.event.id } });
});

test("draft roster departure and rejoin cannot silently publish an old stint", async ({ request }) => {
  const f = await scheduled(request);
  await expect.poll(async () => (await f.snapshot()).phase).toBe("open");
  const view = await f.snapshot();
  const picked = f.members[0].ashedMemberId;
  expect((await f.pick(f.owner, f.payload(view, view.teams[0].id, picked))).status()).toBe(200);
  await f.sql`UPDATE alliance_members SET join_date = '2026-09-11' WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${picked}`;
  const changed = await f.snapshot();
  expect(changed.rosterValid).toBe(false);
  expect(changed.memberLocations[picked]).toBeNull();
  expect((await request.post(`${f.path}/publish`, { headers: f.ownerHeaders, data: { expectedVersion: changed.version, allowUnsorted: true, idempotencyKey: randomUUID() } })).status()).toBe(409);
  const [board] = await f.sql`SELECT published, construction FROM support_team_boards WHERE alliance_id = ${f.allianceId}`;
  expect(board.published).toBe(false);
  expect(board.construction.id).toBe(f.draftId);
  expect((await request.post(`${f.path}/cancel`, { headers: f.ownerHeaders, data: { expectedVersion: changed.version, idempotencyKey: randomUUID() } })).status()).toBe(200);
});
