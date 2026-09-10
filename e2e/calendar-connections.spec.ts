import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";

async function fixture() {
  const sql = getE2eSql();
  const { allianceId } = await createNativeAlliance(sql, { tag: `CA${randomUUID().slice(0, 6)}`, name: "Calendar connections" });
  const user = await createAuthenticatedHqSession(sql, `${randomUUID()}@e2e.test`);
  await createAllianceMembership(sql, { allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
  const member = await createAllianceRosterMember(sql, { allianceId, currentName: "Calendar Commander", allianceRank: 3 });
  await createHqMemberLink(sql, { allianceId, hqUserId: user.hqUserId, ashedMemberId: member.ashedMemberId });
  await sql`UPDATE sessions SET current_alliance_id=${allianceId}, alliance_id=${allianceId} WHERE id=${user.sessionId}`;
  await sql`INSERT INTO regular_event_schedule_rules (id,alliance_id,event_key,schedule_kind,one_shot_dates,anchor_time_st) VALUES (${randomUUID()},${allianceId},'zombie_siege','once',${sql.json([addCalendarDays(getServerCalendarDate(), 1)])},'20:00')`;
  return { sql, allianceId, user };
}

test("member subscribes with two account-level alerts and revokes the private feed", async ({ page, context, baseURL }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  const preferences = await page.request.post("/api/calendar/settings", { data: { action: "preferences", version: 0, preferences: { alerts: [10, 1], locale: "pt-BR", timezone: "America/Sao_Paulo" } } });
  expect(preferences.status()).toBe(200);
  const configured = await page.request.post("/api/calendar/settings", { data: { action: "target", allianceId: f.allianceId, provider: "apple", sources: ["regular"], enabled: true, version: 0 } });
  expect(configured.status()).toBe(200);
  const target = (await configured.json()).targets[0];
  const link = await (await page.request.post("/api/calendar/feed-link", { data: { targetId: target.id } })).json();
  expect(new URL(link.url).origin).toBe(baseURL);
  const feed = await page.request.get(link.url);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect(feed.headers()["cache-control"]).toContain("private");
  const text = await feed.text();
  expect(text).toContain("Cerco Zumbi");
  expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
  expect((await page.request.get(link.url, { headers: { "If-None-Match": feed.headers().etag } })).status()).toBe(304);
  expect(JSON.stringify(await (await page.request.get("/api/calendar/settings")).json())).not.toContain(new URL(link.url).searchParams.get("token"));
  expect((await page.request.post("/api/calendar/settings", { data: { action: "target", allianceId: f.allianceId, provider: "apple", sources: [], enabled: false, version: 1 } })).status()).toBe(200);
  expect((await page.request.get(link.url, { headers: { "If-None-Match": feed.headers().etag } })).status()).toBe(404);
});

test("calendar controls reject anonymous and cross-alliance requests", async ({ page, context, request }) => {
  expect((await request.get("/api/calendar/settings")).status()).toBe(403);
  const f = await fixture(), other = await fixture();
  await context.addCookies(playwrightAuthCookies(f.user));
  expect((await page.request.get("/api/calendar/settings")).status()).toBe(200);
  expect((await page.request.post("/api/calendar/settings", { data: { action: "target", allianceId: other.allianceId, provider: "apple", sources: ["boarding"], enabled: true, version: 0 } })).status()).toBe(403);
  expect((await page.request.get(`/api/calendar/preview?allianceId=${other.allianceId}&source=regular`)).status()).toBe(403);
});
