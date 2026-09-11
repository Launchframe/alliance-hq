import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { getServerCalendarDate } from "../src/lib/trains/game-time";

async function fixture(roleName = "officer") {
  const sql = getE2eSql();
  const { allianceId } = await createNativeAlliance(sql, { tag: `BC${randomUUID().slice(0, 6)}`, name: "Boarding Calendar" });
  const user = await createAuthenticatedHqSession(sql, `${randomUUID()}@e2e.test`);
  await createAllianceMembership(sql, { allianceId, hqUserId: user.hqUserId, roleName, source: "manual" });
  const member = await createAllianceRosterMember(sql, { allianceId, currentName: "Boarding Commander", allianceRank: 4 });
  await createHqMemberLink(sql, { allianceId, hqUserId: user.hqUserId, ashedMemberId: member.ashedMemberId });
  await sql`UPDATE sessions SET alliance_id=${allianceId}, current_alliance_id=${allianceId} WHERE id=${user.sessionId}`;
  const recordId = randomUUID(), date = getServerCalendarDate(), lockedAt = new Date();
  await sql`INSERT INTO train_conductor_records (id,alliance_id,date,conductor_member_id,conductor_member_name,locked_at,locked_by_hq_user_id) VALUES (${recordId},${allianceId},${date},${member.ashedMemberId},'Boarding Commander',${lockedAt},${user.hqUserId})`;
  await sql`INSERT INTO train_boarding_windows (record_id,alliance_id,lock_at) VALUES (${recordId},${allianceId},${lockedAt})`;
  return { sql, allianceId, user, recordId, lockedAt };
}

test("officer enters the game countdown and late metadata updates do not extend boarding", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  expect((await page.request.get(`/api/trains/boarding?recordId=${f.recordId}`)).status()).toBe(200);
  await page.goto("/en-US/trains");
  const boarding = page.getByRole("region", { name: "Train Is Boarding", exact: true });
  await boarding.getByLabel("How much time is left on the train?", { exact: true }).fill("01:20:00");
  await boarding.getByRole("button", { name: "Use countdown", exact: true }).click();
  await expect(boarding.getByText(/^Boarding closes:/)).toBeVisible();
  const [row] = await f.sql`SELECT starts_at,ends_at FROM train_boarding_windows WHERE record_id=${f.recordId}`;
  expect(new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()).toBe(235 * 60_000);
  expect(new Date(row.ends_at).getTime() - Date.now()).toBeLessThanOrEqual(75 * 60_000);
  await f.sql`UPDATE train_conductor_records SET updated_at=now() WHERE id=${f.recordId}`;
  await page.reload();
  await expect(page.getByText(/^Boarding closes:/)).toBeVisible();
  const [later] = await f.sql`SELECT ends_at FROM train_boarding_windows WHERE record_id=${f.recordId}`;
  expect(later.ends_at).toEqual(row.ends_at);
});

test("skip estimates from the original lock time", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  expect((await page.request.get(`/api/trains/boarding?recordId=${f.recordId}`)).status()).toBe(200);
  await page.goto("/en-US/trains");
  const boarding = page.getByRole("region", { name: "Train Is Boarding", exact: true });
  await boarding.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(boarding.getByText("Boarding time estimated from the HQ lock.")).toBeVisible();
  const [row] = await f.sql`SELECT ends_at FROM train_boarding_windows WHERE record_id=${f.recordId}`;
  expect(new Date(row.ends_at).getTime()).toBe(f.lockedAt.getTime() + 235 * 60_000);
});

test("retrying Skip after a lost response reuses the original receipt", async ({ page, context }) => {
  const f = await fixture(); await context.addCookies(playwrightAuthCookies(f.user));
  await page.goto("/en-US/trains");
  const boarding = page.getByRole("region", { name: "Train Is Boarding", exact: true });
  await expect(boarding.getByLabel("How much time is left on the train?", { exact: true })).toBeVisible();
  await page.route((url) => url.pathname === "/api/trains/boarding", async (route) => {
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort();
  }, { times: 1 });
  await boarding.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(boarding.getByText("Could not complete this action. Try again.", { exact: true })).toBeVisible();
  await boarding.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(boarding.getByText("Boarding time estimated from the HQ lock.", { exact: true })).toBeVisible();
  const [row] = await f.sql`SELECT version,ends_at FROM train_boarding_windows WHERE record_id=${f.recordId}`;
  expect(row.version).toBe(2); expect(new Date(row.ends_at).getTime()).toBe(f.lockedAt.getTime() + 235 * 60_000);
});

test("members and anonymous sessions cannot change an officer's boarding window", async ({ page, context, request }) => {
  const f = await fixture("member");
  expect((await request.get(`/api/trains/boarding?recordId=${f.recordId}`)).status()).toBe(403);
  await context.addCookies(playwrightAuthCookies(f.user));
  expect((await page.request.get(`/api/trains/boarding?recordId=${f.recordId}`)).status()).toBe(403);
  expect((await page.request.post("/api/trains/boarding", { data: { action: "begin", recordId: f.recordId } })).status()).toBe(403);
});
