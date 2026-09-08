import { expect, test, type APIRequestContext } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createPlatformMaintainerSession, createNativeAlliance } from "./fixtures/db";
import { createSupportTeamFixture, seedPublishedSupportBoard, selectSupportAlliance } from "./fixtures/support-teams";

async function bootstrapCookie(request: APIRequestContext) {
  const response = await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  const id = response.headers()["set-cookie"]?.match(/alliance_hq_session=([^;]+)/)?.[1];
  expect(id).toBeTruthy();
  return `alliance_hq_session=${id}`;
}

test("support foundation rejects bootstrap and underprivileged officers' endpoints", async ({ request }) => {
  const fixture = await createSupportTeamFixture();
  const cookies = [await bootstrapCookie(request)];
  for (const role of ["member", "viewer", "data_entry"] as const) cookies.push(authCookieHeader(await fixture.actor(role)));
  for (const Cookie of cookies) {
    expect((await request.get("/api/support-teams/history", { headers: { Cookie } })).status()).toBe(403);
    expect((await request.get("/api/events/support-teams", { headers: { Cookie } })).status()).toBe(403);
    for (const path of ["/api/support-teams", "/api/support-teams/history/unknown/undo-preview", "/api/support-teams/history/unknown/undo"]) {
      expect((await request.post(path, { headers: { Cookie }, data: {} })).status()).toBe(403);
    }
  }
  const member = await fixture.actor("member");
  const response = await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(member) } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ teams: [], roster: [], published: false });
  const admin = await createPlatformMaintainerSession(fixture.sql);
  await selectSupportAlliance(admin, fixture.allianceId);
  expect((await request.get("/api/support-teams/history", { headers: { Cookie: authCookieHeader(admin) } })).status()).toBe(200);
});

test("native setup is versioned, UID-safe and cannot bypass publication", async ({ request }) => {
  const f = await createSupportTeamFixture();
  const headers = { Cookie: authCookieHeader(f.owner) };
  const input = { command: { kind: "createTeam", teamId: `team-${nanoid(8)}`, leadId: f.leads[0].ashedMemberId, expectedVersion: 0 }, idempotencyKey: nanoid() };
  const created = await request.post("/api/support-teams", { headers, data: input });
  expect(created.status()).toBe(200);
  const replay = await request.post("/api/support-teams", { headers, data: input });
  expect(await replay.json()).toMatchObject({ replayed: true });
  const snapshot = await request.get("/api/support-teams", { headers });
  const body = await snapshot.json();
  expect(body.roster).toHaveLength(8);
  expect(body.roster[0]).toMatchObject({ thp: null, basePower: null, country: null });
  expect(JSON.stringify(body)).not.toMatch(/game_?uid|notes/i);
  const move = await request.post("/api/support-teams", { headers, data: { command: { kind: "move", memberId: f.members[0].ashedMemberId, from: null, to: input.command.teamId, expectedVersion: body.version }, idempotencyKey: nanoid() } });
  expect(move.status()).toBe(409);
  const other = await createNativeAlliance(f.sql, { tag: `SO${nanoid(5)}`, name: "Other support fixture" });
  await selectSupportAlliance(f.officer, other.allianceId);
  expect((await request.get("/api/support-teams/history", { headers: { Cookie: authCookieHeader(f.officer) } })).status()).toBe(403);
});

async function maintenanceCommand(request: APIRequestContext, Cookie: string, command: Record<string, unknown>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await (await request.get("/api/support-teams", { headers: { Cookie } })).json();
    const response = await request.post("/api/support-teams", { headers: { Cookie }, data: { command: { ...command, expectedVersion: snapshot.version }, idempotencyKey: nanoid() } });
    if (response.status() !== 409 || attempt === 3) return response;
    const error = await response.json();
    if (error.code !== "changed") return response;
  }
  throw new Error("maintenance command retries exhausted");
}

for (const intermediatePoll of [false, true]) {
  test(`departure/rejoin stays unassigned and append-only with intermediate poll=${intermediatePoll}`, async ({ request }) => {
    const f = await createSupportTeamFixture();
    const Cookie = authCookieHeader(f.owner);
    const teamId = `team-${nanoid(8)}`;
    expect((await maintenanceCommand(request, Cookie, { kind: "createTeam", teamId, leadId: f.leads[0].ashedMemberId })).status()).toBe(200);
    await seedPublishedSupportBoard(f.sql, f.allianceId);
    const memberId = f.members[0].ashedMemberId;
    const moved = await maintenanceCommand(request, Cookie, { kind: "move", memberId, from: null, to: teamId });
    expect(moved.status()).toBe(200);
    const original = (await moved.json()).event;
    await f.sql`UPDATE alliance_members SET status = 'former' WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${memberId}`;
    await f.sql`UPDATE member_alliance_tenure SET left_at = now() WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${memberId} AND left_at IS NULL`;
    if (intermediatePoll) {
      const departed = await (await request.get("/api/support-teams", { headers: { Cookie } })).json();
      expect(departed.teams[0].memberIds).not.toContain(memberId);
    }
    await f.sql`INSERT INTO member_alliance_tenure (id, game_uid, alliance_id, ashed_member_id, joined_at) SELECT ${nanoid()}, game_uid, alliance_id, ashed_member_id, now() FROM member_alliance_tenure WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${memberId} ORDER BY joined_at DESC LIMIT 1`;
    await f.sql`UPDATE alliance_members SET status = 'active' WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${memberId}`;
    const returned = await (await request.get("/api/support-teams", { headers: { Cookie } })).json();
    expect(returned.roster.some((row: { id: string }) => row.id === memberId)).toBe(true);
    expect(returned.teams[0].memberIds).not.toContain(memberId);
    expect(JSON.stringify(returned)).not.toMatch(/game_?uid|assignmentStint|\\"membership\\"/i);
    await expect.poll(async () => {
      const rows = await f.sql`SELECT event FROM support_team_events WHERE alliance_id = ${f.allianceId} AND principal_id = 'service:support-team-membership' AND event->'memberIds' ? ${memberId} ORDER BY board_version DESC LIMIT 20`;
      return rows.some((row) => row.event.patches.some((patch: { key: string; after: unknown }) => patch.key === JSON.stringify(["member", memberId, "team"]) && patch.after === null));
    }).toBe(true);
    const undo = await request.post(`/api/support-teams/history/${original.id}/undo-preview`, { headers: { Cookie } });
    expect(undo.status()).toBe(409);
    const history = await (await request.get("/api/support-teams/history", { headers: { Cookie } })).json();
    expect(JSON.stringify(history)).not.toMatch(/game_?uid|assignmentStint|\\"membership\\"/i);
    expect(history.events.find((event: { id: string }) => event.id === original.id).patches).toEqual(original.patches);
  });
}

test("lead departure preserves the named team, explicit return is owner-only, and publication permits a new slot", async ({ request }) => {
  const f = await createSupportTeamFixture();
  const Cookie = authCookieHeader(f.owner);
  const teamId = `team-${nanoid(8)}`;
  const leadId = f.leads[0].ashedMemberId;
  expect((await maintenanceCommand(request, Cookie, { kind: "createTeam", teamId, leadId })).status()).toBe(200);
  expect((await maintenanceCommand(request, authCookieHeader(f.officer), { kind: "rename", teamId, name: "Persistent" })).status()).toBe(200);
  await seedPublishedSupportBoard(f.sql, f.allianceId);
  await f.sql`UPDATE alliance_members SET alliance_rank = 3 WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${leadId}`;
  const ineligible = await (await request.get("/api/support-teams", { headers: { Cookie } })).json();
  expect(ineligible.teams[0]).toMatchObject({ id: teamId, name: "Persistent", needsReplacement: true });
  await f.sql`UPDATE member_alliance_tenure SET left_at = now() WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${leadId} AND left_at IS NULL`;
  await f.sql`INSERT INTO member_alliance_tenure (id, game_uid, alliance_id, ashed_member_id, joined_at) SELECT ${nanoid()}, game_uid, alliance_id, ashed_member_id, now() FROM member_alliance_tenure WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${leadId} ORDER BY joined_at DESC LIMIT 1`;
  await f.sql`UPDATE alliance_members SET alliance_rank = 4 WHERE alliance_id = ${f.allianceId} AND ashed_member_id = ${leadId}`;
  const returned = await (await request.get("/api/support-teams", { headers: { Cookie } })).json();
  expect(returned.teams[0]).toMatchObject({ id: teamId, name: "Persistent", leadId: null, needsReplacement: true });
  expect((await maintenanceCommand(request, authCookieHeader(f.officer), { kind: "replaceLead", teamId, leadId })).status()).toBe(403);
  expect((await maintenanceCommand(request, Cookie, { kind: "replaceLead", teamId, leadId })).status()).toBe(200);
  const extra = { kind: "createTeam", teamId: `team-${nanoid(8)}`, leadId: f.leads[1].ashedMemberId };
  expect((await maintenanceCommand(request, authCookieHeader(f.officer), extra)).status()).toBe(403);
  expect((await maintenanceCommand(request, Cookie, extra)).status()).toBe(200);
  const snapshot = await (await request.get("/api/support-teams", { headers: { Cookie } })).json();
  expect(snapshot.teams).toHaveLength(2);
  expect(snapshot.teams.find((team: { id: string }) => team.id === teamId)).toMatchObject({ name: "Persistent", leadId, needsReplacement: false });
});

test("personal preferences are isolated and version checked", async ({ request }) => {
  const f = await createSupportTeamFixture();
  const display = { professionLevel: true, baseLevel: false, thp: false, tenureDays: true };
  const headers = { Cookie: authCookieHeader(f.officer) };
  const saved = await request.put("/api/support-teams/preferences", { headers, data: { expectedVersion: 0, display } });
  expect(saved.status()).toBe(200);
  expect(await (await request.get("/api/support-teams/preferences", { headers })).json()).toEqual({ version: 1, display });
  expect(await (await request.get("/api/support-teams/preferences", { headers: { Cookie: authCookieHeader(f.owner) } })).json()).toMatchObject({ version: 0 });
  expect((await request.put("/api/support-teams/preferences", { headers, data: { expectedVersion: 0, display } })).status()).toBe(409);
  expect((await request.put("/api/support-teams/preferences", { headers, data: { expectedVersion: 1, display, hqUserId: f.owner.hqUserId } })).status()).toBe(400);
});
