import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";

import {
  authCookieHeader, createAllianceMembership, createAllianceRosterMember,
  createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance,
  getE2eSql, playwrightAuthCookies,
} from "./fixtures/db";
import { addCalendarDays, getServerCalendarDate } from "../src/lib/trains/game-time";

async function fixture() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `TO${nanoid(5)}`, name: "Time Off Test Alliance" });
  async function actor(roleName: "member" | "officer" | "data_entry", name: string) {
    const session = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
    await createAllianceMembership(sql, { hqUserId: session.hqUserId, allianceId: alliance.allianceId, roleName, source: "manual" });
    await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${session.sessionId}`;
    const { ashedMemberId } = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: name, allianceRank: roleName === "officer" ? 4 : 3 });
    await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: session.hqUserId, ashedMemberId, memberDisplayName: name });
    return { ...session, ashedMemberId, headers: { Cookie: authCookieHeader(session) } };
  }
  const member = await actor("member", "Time Off Member");
  const officer = await actor("officer", "Time Off Officer");
  const dataEntry = await actor("data_entry", "Time Off Data Entry");
  const unlinked = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Unlinked Commander", allianceRank: 3 });
  const tomorrow = addCalendarDays(getServerCalendarDate(), 1);
  return { sql, alliance, member, officer, dataEntry, unlinked, tomorrow };
}

test("time-off boundaries deny anonymous, data-entry on-behalf and cross-alliance mutations", async ({ request }) => {
  const f = await fixture();
  const body = { ashedMemberId: f.unlinked.ashedMemberId, startDate: f.tomorrow, endDate: f.tomorrow, requestId: randomUUID() };
  expect((await request.post("/api/time-off/entries", { data: body })).status()).toBe(401);
  await request.get("/api/auth/bootstrap?next=/", { maxRedirects: 0 });
  expect((await request.post("/api/time-off/entries", { data: body })).status()).toBe(403);
  expect((await request.post("/api/time-off/entries", { headers: f.member.headers, data: body })).status()).toBe(403);
  expect((await request.post("/api/time-off/entries", { headers: f.dataEntry.headers, data: body })).status()).toBe(403);
  const created = await request.post("/api/time-off/entries", { headers: f.officer.headers, data: { ...body, entryKind: "officer_marked" } });
  expect(created.status()).toBe(200);
  const { entry } = await created.json();
  expect(entry.memberName).toBe("Unlinked Commander");
  const other = await fixture();
  expect((await request.patch(`/api/time-off/entries/${entry.id}`, { headers: other.officer.headers, data: { ...body, version: entry.version } })).status()).toBe(404);
});

test("private notes, officer flags, idempotency and optimistic versions are enforced by the API", async ({ request }) => {
  const f = await fixture();
  const body = { ashedMemberId: f.member.ashedMemberId, memberName: "Spoofed", startDate: f.tomorrow, endDate: f.tomorrow, notes: "Private test reason", requestId: randomUUID() };
  const responses = await Promise.all([
    request.post("/api/time-off/entries", { headers: f.member.headers, data: body }),
    request.post("/api/time-off/entries", { headers: f.member.headers, data: body }),
  ]);
  expect(responses.map((response) => response.status())).toEqual([200, 200]);
  const first = (await responses[0].json()).entry;
  expect((await responses[1].json()).entry.id).toBe(first.id);
  expect(first.memberName).toBe("Time Off Member");
  const month = f.tomorrow.slice(0, 7);
  const memberView = await (await request.get(`/api/time-off?month=${month}`, { headers: f.member.headers })).json();
  expect(memberView.entries.find((entry: { id: string }) => entry.id === first.id).notes).toBe(body.notes);
  const unrelatedView = await (await request.get(`/api/time-off?month=${month}`, { headers: f.dataEntry.headers })).json();
  expect(unrelatedView.entries.find((entry: { id: string }) => entry.id === first.id).notes).toBeNull();
  expect(JSON.stringify(unrelatedView)).not.toContain(body.notes);
  expect(JSON.stringify(unrelatedView)).not.toContain("game_uid");
  const edited = await request.patch(`/api/time-off/entries/${first.id}`, { headers: f.member.headers, data: { ...body, version: first.version, endDate: addCalendarDays(f.tomorrow, 1) } });
  expect(edited.status()).toBe(200);
  const updated = (await edited.json()).entry;
  expect(updated.version).toBe(first.version + 1);
  expect((await request.delete(`/api/time-off/entries/${first.id}`, { headers: f.member.headers, data: { version: first.version } })).status()).toBe(409);
  expect((await request.delete(`/api/time-off/entries/${first.id}`, { headers: f.member.headers, data: { version: updated.version } })).status()).toBe(200);
  const revisions = await f.sql`SELECT version, snapshot FROM member_time_off_revisions WHERE entry_id = ${first.id} ORDER BY version`;
  expect(revisions).toHaveLength(3);
  expect(revisions[0].snapshot.endDate).toBe(f.tomorrow);
  expect(revisions[2].snapshot.cancelled).toBe(true);
  const flagged = await request.post("/api/time-off/entries", { headers: f.officer.headers, data: { ...body, entryKind: "unexpected", requestId: randomUUID() } });
  const flag = (await flagged.json()).entry;
  expect((await request.patch(`/api/time-off/entries/${flag.id}`, { headers: f.member.headers, data: { ...body, version: flag.version, entryKind: "planned" } })).status()).toBe(403);
  expect((await request.delete(`/api/time-off/entries/${flag.id}`, { headers: f.member.headers, data: { version: flag.version } })).status()).toBe(403);
});

for (const mobile of [false, true]) {
  test(`member previews, edits and cancels absence on ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    const f = await fixture();
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.context().addCookies(playwrightAuthCookies(f.member));
    await page.goto("/time-off");
    await expect(page.getByRole("heading", { name: "My Time Off", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add time off", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Start date", { exact: true }).fill(f.tomorrow);
    await dialog.getByLabel("End date", { exact: true }).fill(f.tomorrow);
    await dialog.getByLabel("Private notes", { exact: false }).fill("Private browser test reason");
    await dialog.getByRole("button", { name: "Review time off", exact: true }).click();
    await expect(dialog.getByText("Check the commander and dates before saving.")).toBeVisible();
    const before = await f.sql`SELECT id FROM member_time_off WHERE alliance_id = ${f.alliance.allianceId}`;
    expect(before).toHaveLength(0);
    await dialog.getByRole("button", { name: "Save time off", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("Time off saved.");
    await page.getByRole("button", { name: "Edit time off", exact: true }).click();
    await dialog.getByLabel("End date", { exact: true }).fill(addCalendarDays(f.tomorrow, 1));
    await dialog.getByRole("button", { name: "Review time off", exact: true }).click();
    let releaseRefresh = () => {};
    const refreshHeld = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    await page.route("**/api/time-off?**", async (route) => {
      const response = await route.fetch();
      await refreshHeld;
      if (!page.isClosed()) await route.fulfill({ response });
    });
    try {
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveText("Time off updated.");
      await page.getByRole("button", { name: "Cancel this entry", exact: true }).click();
      await expect(dialog.getByText("This removes the planned absence. Its history is kept.")).toBeVisible();
      const [cancelled] = await Promise.all([
        page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/api/time-off/entries/")),
        dialog.getByRole("button", { name: "Cancel this entry", exact: true }).click(),
      ]);
      expect(cancelled.status()).toBe(200);
    } finally {
      releaseRefresh();
    }
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByRole("article").getByText("Time off cancelled.")).toBeVisible();
  });
}
