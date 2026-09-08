import { expect, test, type APIRequestContext } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createPlatformMaintainerSession, createNativeAlliance } from "./fixtures/db";
import { createSupportTeamFixture, selectSupportAlliance } from "./fixtures/support-teams";

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
  const move = await request.post("/api/support-teams", { headers, data: { command: { kind: "move", memberId: f.members[0].ashedMemberId, from: null, to: input.command.teamId, expectedVersion: 1 }, idempotencyKey: nanoid() } });
  expect(move.status()).toBe(409);
  const other = await createNativeAlliance(f.sql, { tag: `SO${nanoid(5)}`, name: "Other support fixture" });
  await selectSupportAlliance(f.officer, other.allianceId);
  expect((await request.get("/api/support-teams/history", { headers: { Cookie: authCookieHeader(f.officer) } })).status()).toBe(403);
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
