import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";

test.use({ timezoneId: "UTC" });

async function fixture() {
  const sql = getE2eSql();
  const { allianceId } = await createNativeAlliance(sql, { tag: `PP${randomUUID().slice(0, 6)}`, name: "Plunder Plan" });
  const user = await createAuthenticatedHqSession(sql, `${randomUUID()}@e2e.test`);
  await createAllianceMembership(sql, { allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
  const member = await createAllianceRosterMember(sql, { allianceId, currentName: "Plan Commander", allianceRank: 3 });
  const link = await createHqMemberLink(sql, { allianceId, hqUserId: user.hqUserId, ashedMemberId: member.ashedMemberId });
  await sql`INSERT INTO member_alliance_tenure (id, alliance_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${allianceId}, ${member.ashedMemberId}, ${link.gameUid})`;
  await sql`UPDATE sessions SET alliance_id = ${allianceId}, current_alliance_id = ${allianceId} WHERE id = ${user.sessionId}`;
  return { sql, allianceId, user, member, date: addCalendarDays(getServerCalendarDate(), 1) };
}

test("member creates a one-time Plunder Plan, changes their color and removes it", async ({ page, context }) => {
  const f = await fixture();
  await context.addCookies(playwrightAuthCookies(f.user));
  await page.goto("/en-US/plunder-plan");
  await page.getByRole("button", { name: "Add my times", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Repeat", { exact: true }).selectOption("once");
  await modal.getByLabel("Date", { exact: true }).fill(f.date);
  await modal.getByLabel("Time zone", { exact: true }).fill("Etc/GMT+2");
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Your Plunder Plan is saved." })).toBeVisible();
  await page.getByRole("button", { name: "My calendar color", exact: true }).click();
  await modal.getByLabel("Hex color", { exact: true }).fill("#112233");
  await modal.getByRole("button", { name: "Use this color", exact: true }).click();
  await expect(modal).not.toBeVisible();
  const data = await (await page.request.get("/api/plunder-plan")).json();
  expect(data.color).toBe("#112233");
  expect(data.plans[0].schedule.kind).toBe("once");
  expect(data).not.toHaveProperty("gameUid");
  await page.getByRole("button", { name: "Remove my plan", exact: true }).click();
  await modal.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Ready to find some secret tasks? Add your first Plunder Plan.")).toBeVisible();
});

test("mobile defaults to Day and keeps an explicit Week choice after reload", async ({ page, context }) => {
  const f = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies(playwrightAuthCookies(f.user));
  await page.goto("/en-US/plunder-plan");
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Portuguese view and anonymous API boundaries", async ({ page, context, request }) => {
  expect((await request.get("/api/plunder-plan")).status()).toBeGreaterThanOrEqual(400);
  const f = await fixture();
  await context.addCookies(playwrightAuthCookies(f.user));
  await page.goto("/pt-BR/plunder-plan");
  await expect(page.getByRole("heading", { name: "Plano de Saque", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar meus horários", exact: true })).toBeVisible();
  const response = await page.request.post("/api/plunder-plan", { data: { action: "create", kind: "suggestion", requestId: randomUUID(), reminder: false, schedule: { kind: "once", date: f.date, start: "20:00", end: "21:00", endsNextDay: false, zone: "UTC", days: [] } } });
  expect(response.status()).toBe(403);
});

test("an authenticated role without Plunder Plan permission cannot read the calendar", async ({ page, context }) => {
  const f = await fixture(), role = randomUUID();
  await f.sql`INSERT INTO roles (id, alliance_id, name, is_system) VALUES (${role}, ${f.allianceId}, 'limited', 0)`;
  await f.sql`UPDATE alliance_memberships SET role_id = ${role} WHERE alliance_id = ${f.allianceId} AND hq_user_id = ${f.user.hqUserId}`;
  await context.addCookies(playwrightAuthCookies(f.user));
  expect((await page.request.get("/api/plunder-plan")).status()).toBe(403);
  await page.goto("/en-US/plunder-plan");
  await expect(page.getByRole("heading", { name: "Plunder Plan", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
});

test("regular events appear read-only and can be hidden", async ({ page, context }) => {
  const f = await fixture();
  const dates = Array.from({ length: 8 }, (_, i) => addCalendarDays(getServerCalendarDate(), i));
  await f.sql`INSERT INTO regular_event_schedule_rules (id, alliance_id, event_key, schedule_kind, one_shot_dates, anchor_time_st) VALUES (${randomUUID()}, ${f.allianceId}, 'zombie_siege', 'once', ${f.sql.json(dates)}, '20:00')`;
  await context.addCookies(playwrightAuthCookies(f.user)); await page.goto("/en-US/plunder-plan");
  const markers = page.getByRole("region", { name: "Alliance calendar", exact: true }).getByRole("button", { name: /Zombie Siege/ });
  await expect(markers.first()).toBeVisible(); await markers.first().click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: "Edit my Plunder Plan", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Show regular alliance events", { exact: true }).uncheck();
  await expect(markers).toHaveCount(0);
});

test("100 overlapping plans stay reachable and the detail dialog retains keyboard focus", async ({ page, context }) => {
  const f = await fixture(); const today = new Date().toISOString().slice(0, 10);
  await context.addCookies(playwrightAuthCookies(f.user));
  await page.route("**/api/plunder-plan?*", async (route) => {
    const response = await route.fetch(); const data = await response.json();
    data.occurrences = Array.from({ length: 100 }, (_, i) => ({ id: `friend-${i}`, planId: `friend-${i}`, key: today, localDate: today, startAt: `${today}T12:00:00.000Z`, endAt: `${today}T13:00:00.000Z`, memberName: `Friend ${i}`, color: "#112233", kind: "plan", owned: false, version: 1 }));
    await route.fulfill({ response, json: data });
  });
  await page.goto("/en-US/plunder-plan"); await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.getByRole("button", { name: "Show 97 more", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: /^Friend / })).toHaveCount(100);
  await page.keyboard.press("Tab");
  expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(modal).not.toBeVisible();
});

test("mobile separates vertical scroll from day swipes and supports unavailable storage", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage unavailable"); }; });
  await page.goto("/en-US/plunder-plan");
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  const nav = page.getByRole("navigation", { name: "Alliance calendar", exact: true });
  const before = await nav.textContent();
  const region = page.getByRole("region", { name: "Alliance calendar", exact: true });
  await region.evaluate((element) => {
    const send = (type: string, x: number, y: number) => { const point = new Touch({ identifier: 1, target: element, clientX: x, clientY: y }); element.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [point], changedTouches: [point] })); };
    send("touchstart", 250, 100); send("touchmove", 245, 200); send("touchend", 100, 210);
  });
  await expect(nav).toHaveText(before!);
  await region.evaluate((element) => {
    const send = (type: string, x: number, y: number) => { const point = new Touch({ identifier: 2, target: element, clientX: x, clientY: y }); element.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [point], changedTouches: [point] })); };
    send("touchstart", 250, 100); send("touchmove", 150, 105); send("touchend", 80, 108);
  });
  await expect(nav).not.toHaveText(before!);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
});
