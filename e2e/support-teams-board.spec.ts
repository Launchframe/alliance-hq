import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { nanoid } from "nanoid";
import { playwrightAuthCookies } from "./fixtures/auth";
import { authCookieHeader, createHqMemberLink } from "./fixtures/db";
import { createPublishedSupportTeamFixture } from "./fixtures/support-teams";

async function openBoard(page: Page, context: BrowserContext, actor: Parameters<typeof playwrightAuthCookies>[0]) {
  await context.addCookies(playwrightAuthCookies(actor));
  await page.goto("/support-teams");
  await expect(page.getByRole("heading", { name: "Support teams", exact: true })).toBeVisible();
}

test("desktop board drag/drop and explicit fuzzy selection use confirmed versioned commands", async ({ page, context, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openBoard(page, context, f.owner);
  const cedar = page.locator(`[data-support-team="${f.teams[0]}"]`);
  const harbor = page.locator(`[data-support-team="${f.teams[1]}"]`);
  await expect(cedar).toBeVisible();
  await expect(harbor).toBeVisible();
  const member = page.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`);
  await expect(member.getByRole("img", { name: "Country: Unknown" })).toBeVisible();
  await member.dragTo(cedar);
  await expect(cedar.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`)).toBeVisible();
  let commands = 0;
  page.on("request", (req) => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/support-teams") commands++; });
  const search = harbor.getByRole("combobox", { name: "Add member", exact: true });
  await search.fill("Member 1");
  await expect(page.getByRole("option", { name: /Member 1/ })).toBeVisible();
  await search.press("Enter");
  expect(commands).toBe(0);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(harbor.locator(`[data-support-member="${f.members[1].ashedMemberId}"]`)).toBeVisible();
  expect(commands).toBe(1);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Member 1");
  await search.press("Enter");
  expect(commands).toBe(1);
});

test("keyboard selection never substitutes a different member after a snapshot reorder", async ({ page, context, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openBoard(page, context, f.owner);
  const search = page.locator(`[data-support-team="${f.teams[0]}"]`).getByRole("combobox", { name: "Add member", exact: true });
  await search.fill("Member");
  await expect(page.getByRole("option", { name: /Member 0/ })).toBeVisible();
  await search.press("ArrowDown");
  const firstBefore = await page.getByRole("option").first().innerText();
  let commands = 0;
  page.on("request", (req) => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/support-teams") commands++; });
  await page.route("**/api/support-teams", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, roster: body.roster.slice().reverse() } });
  });
  const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/support-teams") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(page.getByRole("option").first()).not.toHaveText(firstBefore);
  await expect(search).toHaveValue("Member");
  await search.press("Enter");
  expect(commands).toBe(0);
});

test("two desktop contexts preserve the winning move and surface the stale failure beside its slot", async ({ browser, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  const first = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const second = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    await openBoard(a, first, f.officer);
    await openBoard(b, second, f.owner);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let intercepted!: () => void;
    const arrived = new Promise<void>((resolve) => { intercepted = resolve; });
    await b.route("**/api/support-teams", async (route) => { if (route.request().method() !== "POST") return route.continue(); intercepted(); await held; await route.continue(); });
    const target = b.locator(`[data-support-team="${f.teams[1]}"]`);
    await target.getByRole("combobox", { name: "Add member", exact: true }).fill("Member 0");
    await b.getByRole("option", { name: /Member 0/ }).click();
    await arrived;
    const source = a.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`);
    const winner = a.locator(`[data-support-team="${f.teams[0]}"]`);
    await source.dragTo(winner);
    await expect(winner.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`)).toBeVisible();
    release();
    await expect(target.getByRole("alert")).toContainText("The team plan changed.");
    await expect(b.locator(`[data-support-team="${f.teams[0]}"] [data-support-member="${f.members[0].ashedMemberId}"]`)).toBeVisible();
    const snapshot = await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(f.owner) } })).json();
    expect(snapshot.teams.flatMap((team: { memberIds: string[] }) => team.memberIds).filter((id: string) => id === f.members[0].ashedMemberId)).toHaveLength(1);
    const forbidden = await request.post("/api/support-teams", { headers: { Cookie: authCookieHeader(f.officer) }, data: { command: { kind: "move", memberId: f.members[1].ashedMemberId, from: null, to: f.teams[1], expectedVersion: snapshot.version }, idempotencyKey: nanoid() } });
    expect(forbidden.status()).toBe(403);
  } finally { await first.close(); await second.close(); }
});

test("mobile own team, filters, global locator, swipe and tap-add remain independent", async ({ browser, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await openBoard(page, context, f.officer);
    const cedar = page.locator(`[data-support-team="${f.teams[0]}"]`);
    const harbor = page.locator(`[data-support-team="${f.teams[1]}"]`);
    await expect(cedar).toBeVisible();
    await expect(harbor).not.toBeVisible();
    await page.getByRole("button", { name: "Open Unsorted", exact: true }).click();
    const pool = page.getByRole("dialog", { name: "Unsorted", exact: true });
    await pool.getByText("Filter members", { exact: true }).click();
    await pool.getByRole("spinbutton", { name: "THP ≥", exact: true }).fill("999999");
    await pool.getByRole("group", { name: "THP", exact: true }).getByRole("checkbox", { name: "Unknown", exact: true }).uncheck();
    await expect(pool.getByText("No matching members.", { exact: true })).toBeVisible();
    await pool.getByRole("button", { name: "Close Unsorted", exact: true }).click();
    await page.getByRole("combobox", { name: "Find a member", exact: true }).fill("Member 0");
    await page.getByRole("option", { name: /Member 0/ }).click();
    await expect(pool.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`)).toBeVisible();
    await pool.getByRole("button", { name: "Close Unsorted", exact: true }).click();
    const before = await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(f.officer) } })).json();
    expect(before.version).toBe(f.version);
    await cedar.locator("header").dispatchEvent("touchstart", { touches: [{ clientX: 300, clientY: 200 }] });
    await cedar.locator("header").dispatchEvent("touchend", { changedTouches: [{ clientX: 100, clientY: 210 }] });
    await expect(harbor).toBeVisible();
    await harbor.locator("header").dispatchEvent("touchstart", { touches: [{ clientX: 100, clientY: 200 }] });
    await harbor.locator("header").dispatchEvent("touchend", { changedTouches: [{ clientX: 110, clientY: 400 }] });
    await expect(harbor).toBeVisible();
    await page.getByRole("button", { name: "My team", exact: true }).click();
    await page.getByRole("button", { name: "Open Unsorted", exact: true }).click();
    await pool.getByText("Filter members", { exact: true }).click();
    await pool.getByRole("button", { name: "Reset filters", exact: true }).click();
    await pool.locator(`[data-support-member="${f.members[1].ashedMemberId}"]`).getByRole("button", { name: "Add member: Cedar", exact: true }).click();
    await pool.getByRole("button", { name: "Close Unsorted", exact: true }).click();
    await expect(cedar.locator(`[data-support-member="${f.members[1].ashedMemberId}"]`)).toBeVisible();
  } finally { await context.close(); }
});

test("preferences persist only for the current account; members cannot see history or claim controls", async ({ browser, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  const officerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  try {
    const officerPage = await officerContext.newPage();
    const ownerPage = await ownerContext.newPage();
    await openBoard(officerPage, officerContext, f.officer);
    await openBoard(ownerPage, ownerContext, f.owner);
    for (const page of [officerPage, ownerPage]) await page.getByText("Show on member chips", { exact: true }).click();
    const saved = officerPage.waitForResponse((response) => response.url().endsWith("/api/support-teams/preferences") && response.request().method() === "PUT");
    await officerPage.getByRole("checkbox", { name: "Profession level", exact: true }).check();
    expect((await saved).status()).toBe(200);
    await expect(officerPage.getByRole("checkbox", { name: "Profession level", exact: true })).toBeChecked();
    await expect(ownerPage.getByRole("checkbox", { name: "Profession level", exact: true })).not.toBeChecked();
    await officerPage.reload();
    await officerPage.getByText("Show on member chips", { exact: true }).click();
    await expect(officerPage.getByRole("checkbox", { name: "Profession level", exact: true })).toBeChecked();
    const member = await f.actor("member");
    await createHqMemberLink(f.sql, { allianceId: f.allianceId, hqUserId: member.hqUserId, ashedMemberId: f.members[2].ashedMemberId, gameUid: `96${Date.now()}` });
    await officerContext.clearCookies();
    await officerPage.setViewportSize({ width: 390, height: 844 });
    await openBoard(officerPage, officerContext, member);
    await expect(officerPage.getByRole("button", { name: "Team-builder history", exact: true })).toHaveCount(0);
    await expect(officerPage.getByRole("button", { name: "Claim code", exact: true })).toHaveCount(0);
    await expect(officerPage.getByText("You are not assigned to a team.", { exact: true })).toBeVisible();
    const projection = await (await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(member) } })).json();
    expect(projection.board).toBeUndefined();
    expect(projection.actor).toBeUndefined();
    expect(JSON.stringify(projection)).not.toMatch(/game_?uid|privateNote|discipline/i);
    expect((await request.get("/api/settings/team/claimable-commanders", { headers: { Cookie: authCookieHeader(member) } })).status()).toBe(403);
    expect((await request.post("/api/settings/team/invites/bulk-claim", { headers: { Cookie: authCookieHeader(member) }, data: { targetAshedMemberIds: [f.members[0].ashedMemberId] } })).status()).toBe(403);
  } finally { await officerContext.close(); await ownerContext.close(); }
});

test("targeted member claim uses existing private controls without a game server prerequisite", async ({ page, context, request }) => {
  const f = await createPublishedSupportTeamFixture(request);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await openBoard(page, context, f.owner);
  await expect(page.locator(`[data-support-member="${f.leads[0].ashedMemberId}"]`).getByRole("button", { name: "Claim code", exact: true })).toHaveCount(0);
  await page.locator(`[data-support-member="${f.members[0].ashedMemberId}"]`).getByRole("button", { name: "Claim code", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Commander claim invite", exact: true });
  await dialog.getByRole("button", { name: "Generate claim code", exact: true }).click();
  await expect(dialog.getByText("Claim code ready for Member 0.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Claim code", { exact: true })).toBeVisible();
  const claimed = await request.post("/api/settings/team/invites/bulk-claim", { headers: { Cookie: authCookieHeader(f.owner) }, data: { targetAshedMemberIds: [f.leads[0].ashedMemberId] } });
  expect((await claimed.json()).created).toHaveLength(0);
  expect((await request.get("/api/support-teams", { headers: { Cookie: authCookieHeader(f.owner) } })).status()).toBe(200);
});
