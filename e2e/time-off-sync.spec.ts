import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import {
  authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAshedAlliance,
  createAuthenticatedHqSession, createHqMemberLink, getE2eSql, playwrightAuthCookies,
} from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";

async function syncFixture() {
  const sql = getE2eSql();
  const alliance = await createAshedAlliance(sql, { tag: `AS${nanoid(5)}`, name: "Ashed Sync Test" });
  await sql`UPDATE alliances SET ashed_alliance_id = ${`external-${alliance.allianceId}`} WHERE id = ${alliance.allianceId}`;
  async function actor(roleName: "member" | "officer" | "data_entry") {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    const { ashedMemberId } = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: `Sync ${roleName}`, allianceRank: roleName === "officer" ? 4 : 3 });
    await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, ashedMemberId });
    return { ...session, ashedMemberId, headers: { Cookie: authCookieHeader(session) } };
  }
  const officer = await actor("officer");
  const member = await actor("member");
  const dataEntry = await actor("data_entry");
  const date = addCalendarDays(getServerCalendarDate(), 1);
  return { sql, alliance, officer, member, dataEntry, date };
}

test("sync surfaces reject bootstrap, underprivileged users and unauthenticated cron calls", async ({ request }) => {
  const f = await syncFixture();
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.post("/api/time-off/sync", { data: { action: "refresh" } })).status()).toBe(403);
  for (const actor of [f.member, f.dataEntry]) {
    expect((await request.post("/api/time-off/sync", { headers: actor.headers, data: { action: "refresh" } })).status()).toBe(403);
    expect((await request.get("/api/time-off/entries/unknown/sync", { headers: actor.headers })).status()).toBe(403);
    expect((await request.post("/api/time-off/entries/unknown/sync", { headers: actor.headers, data: { action: "retry", version: 1 } })).status()).toBe(403);
  }
  expect((await request.get("/api/internal/time-off/sync")).status()).toBe(403);
});

test("Ashed outages preserve local absence and private notes while durable work remains visible", async ({ request, page }) => {
  const f = await syncFixture();
  const created = await request.post("/api/time-off/entries", {
    headers: f.officer.headers,
    data: { ashedMemberId: f.officer.ashedMemberId, startDate: f.date, endDate: f.date, notes: "PRIVATE_SYNC_NOTE", requestId: randomUUID() },
  });
  expect(created.status()).toBe(200);
  const { entry } = await created.json();
  expect(entry.syncStatus).toBe("pending");
  const jobs = await f.sql`SELECT desired FROM time_off_sync_jobs WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(jobs).toHaveLength(2);
  expect(JSON.stringify(jobs)).not.toContain("PRIVATE_SYNC_NOTE");
  await expect.poll(async () => {
    const [row] = await f.sql`SELECT sync_status FROM member_time_off WHERE id = ${entry.id}`;
    return row.sync_status;
  }).toBe("credentials_required");
  const detail = await request.get(`/api/time-off/entries/${entry.id}/sync`, { headers: f.officer.headers });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).bindings).toHaveLength(2);
  expect((await request.get(`/api/time-off/entries/${entry.id}/sync`, { headers: f.member.headers })).status()).toBe(403);
  const memberView = await (await request.get(`/api/time-off?month=${f.date.slice(0, 7)}`, { headers: f.member.headers })).json();
  expect(JSON.stringify(memberView)).not.toContain("PRIVATE_SYNC_NOTE");
  expect(JSON.stringify(memberView)).not.toContain("remoteSnapshot");
  await page.context().addCookies(playwrightAuthCookies(f.officer));
  await page.goto("/time-off");
  await expect(page.getByText("An alliance officer needs to connect or refresh the alliance’s Ashed connection.", { exact: true })).toBeVisible();
  await page.route((url) => url.pathname === "/api/time-off", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const data = await response.json();
    for (const current of [...data.entries, ...data.ownEntries]) {
      if (current.id === entry.id) current.syncStatus = "pending";
    }
    await route.fulfill({ response, json: data });
  });
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect(page.getByText("Saved in HQ. Waiting to sync with Ashed.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sync retry queued.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh from Ashed", exact: true }).click();
  await expect(page.getByText("Ashed refresh queued.", { exact: true })).toBeVisible();
  const [saved] = await f.sql`SELECT notes, cancelled_at FROM member_time_off WHERE id = ${entry.id}`;
  expect(saved.notes).toBe("PRIVATE_SYNC_NOTE");
  expect(saved.cancelled_at).toBeNull();
});

test("sync recovery rejects stale versions, foreign entries and forged binding IDs", async ({ request }) => {
  const f = await syncFixture();
  const created = await request.post("/api/time-off/entries", { headers: f.officer.headers, data: { ashedMemberId: f.member.ashedMemberId, startDate: f.date, endDate: f.date, requestId: randomUUID() } });
  const { entry } = await created.json();
  expect((await request.post(`/api/time-off/entries/${entry.id}/sync`, { headers: f.officer.headers, data: { action: "retry", version: entry.version - 1 } })).status()).toBe(409);
  expect((await request.post(`/api/time-off/entries/${entry.id}/sync`, { headers: f.officer.headers, data: { action: "keep_hq", version: entry.version, bindingId: "forged", fingerprint: null } })).status()).toBe(409);
  const other = await syncFixture();
  expect((await request.get(`/api/time-off/entries/${entry.id}/sync`, { headers: other.officer.headers })).status()).toBe(404);
  expect((await request.post(`/api/time-off/entries/${entry.id}/sync`, { headers: other.officer.headers, data: { action: "retry", version: entry.version } })).status()).toBe(404);
});
