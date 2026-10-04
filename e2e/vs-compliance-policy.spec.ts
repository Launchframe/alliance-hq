import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import { authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { firstFullVsWeek } from "../src/lib/vs-compliance/policy.shared";
import { addCalendarDays } from "../src/lib/trains/game-time";

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

test("browser configures a separate weekly minimum and explicitly enables a future policy version", async ({ page, context }) => {
  const f = await fixture(); const owner = await f.actor("owner");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Policy Owner", allianceRank: 5 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: owner.hqUserId, ashedMemberId: linked.ashedMemberId });
  await context.addCookies(playwrightAuthCookies(owner));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByLabel("Daily VS target", { exact: true })).toHaveValue("7200000");
  await expect(page.getByLabel("Weekly VS minimum", { exact: true })).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "Enable weekly discipline" })).not.toBeChecked();
  await page.getByLabel("Weekly VS minimum", { exact: true }).fill("40000000");
  await page.getByLabel("Penalty policy", { exact: true }).selectOption("consecutive");
  await page.getByLabel("Consecutive misses before removal", { exact: true }).fill("5");
  const effective = addCalendarDays(firstFullVsWeek(new Date()), 7);
  await page.getByLabel("Effective from", { exact: true }).fill(effective);
  await page.getByRole("checkbox", { name: "Enable weekly discipline" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Policy settings saved.", { exact: true })).toBeVisible();
  const rows = await f.sql`SELECT version, enabled, weekly_minimum, daily_target, effective_week, preset, removal_threshold FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(rows).toHaveLength(1);
  expect({ ...rows[0], weekly_minimum: Number(rows[0].weekly_minimum), daily_target: Number(rows[0].daily_target) }).toMatchObject({ version: 1, enabled: true, weekly_minimum: 40000000, daily_target: 7200000, effective_week: effective, preset: "consecutive", removal_threshold: 5 });
  await page.getByLabel("Penalty policy", { exact: true }).selectOption("rank_aware");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await f.sql`SELECT id FROM vs_compliance_policies WHERE alliance_id = ${f.alliance.allianceId}`).length).toBe(2);
});

test("browser officers inspect read-only settings and stale owner saves retain inputs", async ({ page, context }) => {
  const f = await fixture(); const owner = await f.actor("owner"); const officer = await f.actor("officer");
  for (const actor of [owner, officer]) {
    const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: `Policy ${actor.hqUserId}`, allianceRank: 4 });
    await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: actor.hqUserId, ashedMemberId: linked.ashedMemberId });
  }
  await context.addCookies(playwrightAuthCookies(officer));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await expect(page.getByLabel("Daily VS target", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await context.addCookies(playwrightAuthCookies(owner));
  await page.goto("/en-US/settings/vs-membership-minimums");
  await page.getByLabel("Weekly VS minimum", { exact: true }).fill("50000000");
  expect((await page.request.patch(f.url, { data: { expectedVersion: 0, weeklyMinimum: 40000000 } })).status()).toBe(200);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#hq-app-shell").getByRole("alert").filter({ hasText: "The evidence, policy, or member rank changed." })).toBeVisible();
  await expect(page.getByLabel("Weekly VS minimum", { exact: true })).toHaveValue("50000000");
});

test("browser renders the empty compliance response without an actionable placeholder", async ({ page, context }) => {
  const f = await fixture(); const officer = await f.actor("officer");
  const linked = await createAllianceRosterMember(f.sql, { allianceId: f.alliance.allianceId, currentName: "Empty Officer", allianceRank: 4 });
  await createHqMemberLink(f.sql, { allianceId: f.alliance.allianceId, hqUserId: officer.hqUserId, ashedMemberId: linked.ashedMemberId });
  await context.addCookies(playwrightAuthCookies(officer));
  await page.route("**/api/vs-compliance?*", async (route) => {
    const weekEnding = new URL(route.request().url()).searchParams.get("weekEnding");
    await route.fulfill({ json: { weekEnding, canManage: true, rows: [] } });
  });
  await page.goto("/en-US/vs-compliance");
  await expect(page.getByText("No pending compliance actions.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm in-game action" })).toHaveCount(0);
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
