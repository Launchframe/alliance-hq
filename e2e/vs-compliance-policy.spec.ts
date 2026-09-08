import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createAllianceMembership, createAuthenticatedHqSession, createNativeAlliance, getE2eSql } from "./fixtures/db";

async function fixture() {
  const sql = getE2eSql();
  const tag = `VC${nanoid(6)}`;
  const alliance = await createNativeAlliance(sql, { tag, name: "Native Compliance Policy" });
  async function actor(roleName: "owner" | "officer" | "member" | "data_entry" | "viewer") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    return { ...session, headers: { Cookie: authCookieHeader(session) } };
  }
  return { sql, alliance, actor, url: `/api/alliance/${tag}/vs-membership-minimums` };
}

test("compliance policy denies no-cookie, bootstrap, member, viewer and data-entry access", async ({ request }) => {
  const f = await fixture();
  const data = { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000 };
  expect((await request.get(f.url)).status()).toBe(401);
  expect((await request.patch(f.url, { data })).status()).toBe(401);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.get(f.url)).status()).toBe(403);
  expect((await request.patch(f.url, { data })).status()).toBe(403);
  for (const role of ["member", "viewer", "data_entry"] as const) {
    const actor = await f.actor(role);
    expect((await request.get(f.url, { headers: actor.headers })).status()).toBe(403);
    expect((await request.patch(f.url, { headers: actor.headers, data })).status()).toBe(403);
  }
  const rows = await f.sql`SELECT id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(rows).toHaveLength(0);
});

test("native officers can inspect policy but only owner-equivalent roles can configure it", async ({ request }) => {
  const f = await fixture();
  const officer = await f.actor("officer");
  const owner = await f.actor("owner");
  const data = { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5 };
  const read = await request.get(f.url, { headers: officer.headers });
  expect(read.status()).toBe(200);
  expect(await read.json()).toMatchObject({ latest: null, canManage: false, defaults: { enabled: false, dailyTarget: 7_200_000, weeklyMinimum: null } });
  expect((await request.patch(f.url, { headers: officer.headers, data })).status()).toBe(403);
  const saved = await request.patch(f.url, { headers: owner.headers, data });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({ latest: { version: 1, enabled: true, weeklyMinimum: 40_000_000, removalThreshold: 5, preset: "consecutive" } });
  const readAgain = await request.get(f.url, { headers: officer.headers });
  const payload = await readAgain.json();
  expect(payload.history).toHaveLength(1);
  expect(JSON.stringify(payload)).not.toContain("createdByHqUserId");
  expect(JSON.stringify(payload)).not.toContain("game_uid");
  const other = await fixture();
  const otherOwner = await other.actor("owner");
  expect((await request.get(f.url, { headers: otherOwner.headers })).status()).toBe(403);
  expect((await request.patch(f.url, { headers: otherOwner.headers, data: { expectedVersion: 1, leewayPct: 5 } })).status()).toBe(403);
});

test("policy PATCH preserves history, rejects retroactivity, and serializes stale double submissions", async ({ request }) => {
  const f = await fixture();
  const owner = await f.actor("owner");
  const created = await request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5 } });
  expect(created.status()).toBe(200);
  const first = (await created.json()).latest;
  const results = await Promise.all([5, 10].map((leewayPct) => request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 1, leewayPct } })));
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  const read = await request.get(f.url, { headers: owner.headers });
  const policy = await read.json();
  expect(policy.history).toHaveLength(2);
  expect(policy.history[1]).toEqual(first);
  expect(policy.latest).toMatchObject({ version: 2, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5, effectiveWeek: first.effectiveWeek });
  expect((await request.patch(f.url, { headers: owner.headers, data: { expectedVersion: 2, effectiveWeek: "2020-01-05", weeklyMinimum: 80_000_000 } })).status()).toBe(400);
  const rows = await f.sql`SELECT version, created_by_hq_user_id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId} ORDER BY version`;
  expect(rows.map((row) => row.version)).toEqual([1, 2]);
  expect(rows.every((row) => row.created_by_hq_user_id === owner.hqUserId)).toBe(true);
});
