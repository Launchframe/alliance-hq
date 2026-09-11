import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authCookieHeader, createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";

const mocked = process.env.CALENDAR_GOOGLE_TRANSPORT === "mock";
test.skip(!mocked, "Requires the explicit local Google provider profile");

async function fixture() {
  const sql = getE2eSql(), { allianceId } = await createNativeAlliance(sql, { tag: `GO${randomUUID().slice(0, 6)}`, name: "Google calendar" });
  const user = await createAuthenticatedHqSession(sql, `${randomUUID()}@e2e.test`);
  await createAllianceMembership(sql, { allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
  const member = await createAllianceRosterMember(sql, { allianceId, currentName: "Calendar Commander", allianceRank: 3 });
  await createHqMemberLink(sql, { allianceId, hqUserId: user.hqUserId, ashedMemberId: member.ashedMemberId });
  await sql`UPDATE sessions SET current_alliance_id=${allianceId}, alliance_id=${allianceId} WHERE id=${user.sessionId}`;
  await sql`INSERT INTO regular_event_schedule_rules (id,alliance_id,event_key,schedule_kind,one_shot_dates,anchor_time_st) VALUES (${randomUUID()},${allianceId},'zombie_siege','once',${sql.json([addCalendarDays(getServerCalendarDate(), 1)])},'20:00')`;
  return { sql, allianceId, user };
}

test("member connects Google separately, syncs two alerts, then disconnects with cleanup", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  await page.addLocatorHandler(page.getByTestId("hq-release-notes-drawer"), async () => { await page.getByTestId("hq-release-notes-dismiss").click(); });
  await page.goto("/account/calendars");
  const google = page.getByRole("region", { name: "Google Calendar", exact: true });
  await google.getByRole("button", { name: "Connect Google Calendar", exact: true }).click();
  await expect(page).toHaveURL(/calendar=connected/);
  await expect(google.getByText("calendar-provider@example.test", { exact: true })).toBeVisible();
  const alerts = page.getByRole("form", { name: "Calendar alerts", exact: true });
  await alerts.getByRole("button", { name: "Add alert", exact: true }).click(); await alerts.getByLabel("Minutes before start").nth(0).fill("10");
  await alerts.getByRole("button", { name: "Add alert", exact: true }).click(); await alerts.getByLabel("Minutes before start").nth(1).fill("1");
  await alerts.getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const calendar = page.getByRole("form", { name: /Google Calendar/ });
  await calendar.getByLabel("Sync this calendar", { exact: true }).check(); await calendar.getByRole("button", { name: "Save", exact: true }).click();
  await expect(calendar.getByRole("status")).toHaveText("Waiting to sync");
  const tick = await page.request.get("/api/internal/calendar/sync", { headers: { Authorization: "Bearer calendar-e2e-cron-secret" } });
  expect(tick.status()).toBe(200);
  await expect(calendar.getByRole("status")).toHaveText("Up to date", { timeout: 20_000 });
  const [entry] = await f.sql`SELECT e.* FROM calendar_entries e JOIN calendar_targets t ON t.id=e.target_id WHERE t.hq_user_id=${f.user.hqUserId} AND t.provider='google'`;
  expect(entry.payload.alerts).toEqual([10, 1]); expect(entry.remote_confirmed).toBe(true); expect(entry.uncertain).toBe(false);
  await google.getByRole("button", { name: "Stop syncing", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Stop syncing", exact: true });
  await confirmation.getByLabel("Remove synced HQ events from Google Calendar", { exact: true }).check();
  await confirmation.getByRole("button", { name: "Stop syncing", exact: true }).click(); await expect(confirmation).not.toBeVisible();
  expect((await page.request.get("/api/internal/calendar/sync", { headers: { Authorization: "Bearer calendar-e2e-cron-secret" } })).status()).toBe(200);
  await expect(google.getByRole("button", { name: "Connect Google Calendar", exact: true })).toBeVisible({ timeout: 20_000 });
  const [account] = await f.sql`SELECT status,refresh_token,access_token FROM calendar_accounts WHERE hq_user_id=${f.user.hqUserId}`;
  expect(account.status).toBe("revoked"); expect(account.refresh_token).toBeNull(); expect(account.access_token).toBeNull();
});

test("OAuth callback binds the initiating HQ account, cookie and one-time state", async ({ page, context, request }) => {
  const f = await fixture(), other = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  expect((await request.post("/api/calendar/google/start")).status()).toBe(403);
  const started = await page.request.post("/api/calendar/google/start"); expect(started.status()).toBe(200);
  const { url } = await started.json();
  expect(new URL(url).origin).toBe(process.env.CALENDAR_GOOGLE_TEST_ORIGIN);
  const authorized = await page.request.get(url, { maxRedirects: 0 });
  const callback = authorized.headers().location;
  expect(new URL(callback).origin).toBe(new URL(page.url() === "about:blank" ? process.env.PLAYWRIGHT_BASE_URL! : page.url()).origin);
  const state = new URL(callback).searchParams.get("state")!;
  const foreign = await request.get(callback, { maxRedirects: 0, headers: { Cookie: `${authCookieHeader(other.user)}; hq-calendar-oauth=${state}` } });
  expect(foreign.headers().location).toContain("calendar=failed");
  expect(await f.sql`SELECT id FROM calendar_accounts WHERE hq_user_id=${other.user.hqUserId}`).toHaveLength(0);
  const completed = await page.request.get(callback, { maxRedirects: 0 });
  expect(completed.headers().location).toContain("calendar=connected");
  const replay = await page.request.get(callback, { maxRedirects: 0 }); expect(replay.headers().location).toContain("calendar=failed");
  expect(await f.sql`SELECT id FROM calendar_accounts WHERE hq_user_id=${f.user.hqUserId}`).toHaveLength(1);
});
