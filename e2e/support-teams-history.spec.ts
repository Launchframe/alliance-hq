import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, type SessionFixture } from "./fixtures/db";
import { createSupportTeamFixture, seedPublishedSupportBoard } from "./fixtures/support-teams";

test("officer history and owner cascade preserve unrelated work and immutable actors", async ({ request }) => {
  const f = await createSupportTeamFixture();
  const teams = [`team-${nanoid(8)}`, `team-${nanoid(8)}`];
  let version = 0;
  const command = async (actor: SessionFixture, operation: Record<string, unknown>) => {
    const response = await request.post("/api/support-teams", { headers: { Cookie: authCookieHeader(actor) }, data: { command: { ...operation, expectedVersion: version }, idempotencyKey: nanoid() } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    version = body.event.boardVersion;
    return body.event;
  };
  for (const [index, teamId] of teams.entries()) await command(f.owner, { kind: "createTeam", teamId, leadId: f.leads[index].ashedMemberId });
  version = await seedPublishedSupportBoard(f.sql, f.allianceId);
  const memberId = f.members[0].ashedMemberId;
  const root = await command(f.officer, { kind: "move", memberId, from: null, to: teams[0] });
  const away = await command(f.owner, { kind: "move", memberId, from: teams[0], to: teams[1] });
  await command(f.owner, { kind: "rename", teamId: teams[1], name: "Preserved" });
  const back = await command(f.owner, { kind: "move", memberId, from: teams[1], to: teams[0] });
  const officerHeaders = { Cookie: authCookieHeader(f.officer) };
  const ownerHeaders = { Cookie: authCookieHeader(f.owner) };
  const history = await request.get("/api/support-teams/history?limit=50", { headers: officerHeaders });
  expect(history.status()).toBe(200);
  const events = (await history.json()).events as { kind: string; principalId: string; actorType?: string; reverses: string[] }[];
  expect(events).toHaveLength(8);
  expect(events.filter((event) => event.principalId === f.owner.hqUserId || event.principalId === f.officer.hqUserId)).toHaveLength(6);
  expect(events.filter((event) => event.kind === "reconcile")).toEqual([
    expect.objectContaining({ kind: "reconcile", principalId: "service:support-team-membership", actorType: "service", reverses: [] }),
  ]);
  const blocked = await request.post(`/api/support-teams/history/${root.id}/undo-preview`, { headers: officerHeaders });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toMatchObject({ code: "dependencies" });
  expect((await request.post(`/api/support-teams/history/${away.id}/undo-preview`, { headers: officerHeaders })).status()).toBe(403);
  const previewResponse = await request.post(`/api/support-teams/history/${root.id}/undo-preview`, { headers: ownerHeaders });
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(preview.actionIds).toEqual([back.id, away.id, root.id]);
  const data = { actionIds: preview.actionIds, expectedVersions: preview.expectedVersions, idempotencyKey: nanoid() };
  const responses = await Promise.all([1, 2].map(() => request.post(`/api/support-teams/history/${root.id}/undo`, { headers: ownerHeaders, data })));
  expect(responses.map((response) => response.status())).toEqual([200, 200]);
  const [count] = await f.sql`SELECT count(*)::int AS count FROM support_team_reversals WHERE alliance_id = ${f.allianceId}`;
  expect(count.count).toBe(3);
  const snapshot = await (await request.get("/api/support-teams", { headers: ownerHeaders })).json();
  expect(snapshot.teams.find((team: { id: string }) => team.id === teams[1]).name).toBe("Preserved");
  expect(snapshot.teams.flatMap((team: { memberIds: string[] }) => team.memberIds)).not.toContain(memberId);
  const [original] = await f.sql`SELECT event FROM support_team_events WHERE id = ${root.id}`;
  expect(original.event.principalId).toBe(f.officer.hqUserId);
  expect(original.event.reverses).toEqual([]);
  await f.sql`UPDATE alliance_memberships SET status = 'inactive' WHERE hq_user_id = ${f.officer.hqUserId} AND alliance_id = ${f.allianceId}`;
  expect((await request.get("/api/support-teams/history", { headers: officerHeaders })).status()).toBe(403);
});
