import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";

async function fixture() {
  const sql = getE2eSql();
  const { allianceId } = await createNativeAlliance(sql, { tag: `PP${randomUUID().slice(0, 6)}`, name: "Plunder Plan" });
  const user = await createAuthenticatedHqSession(sql, `${randomUUID()}@e2e.test`);
  await createAllianceMembership(sql, { allianceId, hqUserId: user.hqUserId, roleName: "member", source: "manual" });
  const member = await createAllianceRosterMember(sql, { allianceId, currentName: "Plan Commander", allianceRank: 3 });
  const link = await createHqMemberLink(sql, { allianceId, hqUserId: user.hqUserId, ashedMemberId: member.ashedMemberId });
  await sql`INSERT INTO member_alliance_tenure (id, alliance_id, ashed_member_id, game_uid) VALUES (${randomUUID()}, ${allianceId}, ${member.ashedMemberId}, ${link.gameUid})`;
  await sql`UPDATE sessions SET alliance_id = ${allianceId}, current_alliance_id = ${allianceId} WHERE id = ${user.sessionId}`;
  return { user, member, date: addCalendarDays(getServerCalendarDate(), 1) };
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
