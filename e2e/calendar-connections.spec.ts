import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";
import { lastSeenReleaseVersionStorageKey } from "../src/lib/release-notes/version";
import packageJson from "../package.json";

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

test("calendar settings keep two alerts across Commanders and rotate a private Apple subscription", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  await page.addLocatorHandler(page.getByTestId("hq-release-notes-drawer"), async () => { await page.getByTestId("hq-release-notes-dismiss").click(); });
  const commander = await createAllianceRosterMember(f.sql, { allianceId: f.allianceId, currentName: "Second Commander", allianceRank: 3 });
  await createHqMemberLink(f.sql, { allianceId: f.allianceId, hqUserId: f.user.hqUserId, ashedMemberId: commander.ashedMemberId });
  await page.goto("/account");
  await page.getByRole("link", { name: "Calendar connections", exact: true }).click();
  const alerts = page.getByRole("form", { name: "Calendar alerts", exact: true });
  await alerts.getByRole("button", { name: "Add alert", exact: true }).click();
  await alerts.getByLabel("Minutes before start", { exact: true }).nth(0).fill("10");
  await alerts.getByRole("button", { name: "Add alert", exact: true }).click();
  await alerts.getByLabel("Minutes before start", { exact: true }).nth(1).fill("1");
  await alerts.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const apple = page.getByRole("form", { name: /Apple Calendar/ });
  await apple.getByLabel("Sync this calendar", { exact: true }).check();
  await apple.getByRole("button", { name: "Save", exact: true }).click();
  await apple.getByRole("button", { name: "Subscribe in Apple Calendar", exact: true }).click();
  const oldLink = await apple.getByLabel("Copy private link", { exact: true }).inputValue();
  await apple.getByRole("button", { name: "Replace private link", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Replace private link", exact: true });
  await expect(dialog).toBeVisible(); await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("g"); await page.keyboard.press("t");
  await expect(page).toHaveURL(/account\/calendars/);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  expect((await page.request.get(oldLink)).status()).toBe(200);
  await apple.getByRole("button", { name: "Replace private link", exact: true }).click();
  await dialog.getByRole("button", { name: "Replace private link", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await page.request.get(oldLink)).status()).toBe(404);
  await page.reload();
  await expect(page.getByLabel("Minutes before start", { exact: true }).nth(0)).toHaveValue("10");
  await expect(page.getByLabel("Minutes before start", { exact: true }).nth(1)).toHaveValue("1");
  const [row] = await f.sql`SELECT count(*)::int AS count FROM calendar_preferences WHERE hq_user_id=${f.user.hqUserId}`;
  expect(row.count).toBe(1);
});

test("mobile Portuguese calendar settings expose authorized previews and a keyboard route", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  await page.addInitScript(({ key, version }) => localStorage.setItem(key, version), { key: lastSeenReleaseVersionStorageKey(f.user.sessionId), version: packageJson.version });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pt-BR/account/calendars");
  await expect(page.getByRole("heading", { name: "Conexões de calendário", exact: true })).toBeVisible();
  const alerts = page.getByRole("form", { name: "Alertas do calendário", exact: true });
  await alerts.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByRole("form", { name: /Calendário Apple/ }).getByRole("button", { name: "Prévia", exact: true }).click();
  await expect(page.getByRole("region", { name: "Prévia", exact: true }).getByText("Cerco Zumbi", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/account");
  await page.getByRole("link", { name: "Conexões de calendário", exact: true }).focus();
  await page.keyboard.press("g"); await page.keyboard.press("-");
  await expect(page).toHaveURL(/account\/calendars/);
});

test("a stale calendar save reports its error beside that calendar", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  await page.request.post("/api/calendar/settings", { data: { action: "preferences", version: 0, preferences: { alerts: [], locale: "en-US", timezone: "UTC" } } });
  await page.addLocatorHandler(page.getByTestId("hq-release-notes-drawer"), async () => { await page.getByTestId("hq-release-notes-dismiss").click(); });
  await page.goto("/account/calendars");
  const apple = page.getByRole("form", { name: /Apple Calendar/ });
  await apple.getByLabel("Sync this calendar", { exact: true }).check();
  await page.route("**/api/calendar/settings", (route) => route.fulfill({ status: 409, json: { code: "stale" } }), { times: 1 });
  await apple.getByRole("button", { name: "Save", exact: true }).click();
  await expect(apple.getByRole("alert")).toHaveText("This has changed. Refresh and try again.");
});

test("calendar controls reject anonymous and cross-alliance requests", async ({ page, context, request }) => {
  expect((await request.get("/api/calendar/settings")).status()).toBe(403);
  const f = await fixture(), other = await fixture();
  await context.addCookies(playwrightAuthCookies(f.user));
  expect((await page.request.get("/api/calendar/settings")).status()).toBe(200);
  expect((await page.request.post("/api/calendar/settings", { data: { action: "target", allianceId: other.allianceId, provider: "apple", sources: ["boarding"], enabled: true, version: 0 } })).status()).toBe(403);
  expect((await page.request.get(`/api/calendar/preview?allianceId=${other.allianceId}&source=regular`)).status()).toBe(403);
});
