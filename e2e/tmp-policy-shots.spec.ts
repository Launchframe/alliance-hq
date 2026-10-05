import { test } from "@playwright/test";
import { nanoid } from "nanoid";
import { createAllianceMembership, createAllianceRosterMember, createAuthenticatedHqSession, createHqMemberLink, createNativeAlliance, getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { firstFullVsWeek } from "../src/lib/vs-compliance/policy.shared";
import { addCalendarDays } from "../src/lib/trains/game-time";

test("policy workspace screenshots", async ({ page, context, request }) => {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, { tag: `PS${nanoid(5)}`, name: "Policy Shots" });
  const owner = await createAuthenticatedHqSession(sql, `${nanoid(12)}@e2e.test`);
  await createAllianceMembership(sql, { allianceId: alliance.allianceId, hqUserId: owner.hqUserId, roleName: "owner", source: "manual" });
  await sql`UPDATE sessions SET alliance_id = ${alliance.allianceId}, current_alliance_id = ${alliance.allianceId} WHERE id = ${owner.sessionId}`;
  const linked = await createAllianceRosterMember(sql, { allianceId: alliance.allianceId, currentName: "Shot Owner", allianceRank: 5 });
  await createHqMemberLink(sql, { allianceId: alliance.allianceId, hqUserId: owner.hqUserId, ashedMemberId: linked.ashedMemberId });
  await request.patch(`/api/alliance/${alliance.tag}/vs-membership-minimums`, { headers: { Cookie: `alliance_hq_session=${owner.sessionId}` }, data: { expectedVersion: 0, enabled: true, weeklyMinimum: 40_000_000, preset: "consecutive", removalThreshold: 5 } });
  await context.addCookies(playwrightAuthCookies(owner));

  const effective = addCalendarDays(firstFullVsWeek(new Date()), 7);
  const seed = async () => {
    await page.goto("/en-US/settings/vs-membership-minimums");
    await page.getByLabel("Daily minimum", { exact: true }).fill("7200000");
    await page.getByLabel("Missed days allowed per week", { exact: true }).fill("1");
    await page.getByLabel("Effective VS week", { exact: true }).fill(effective);
  };

  await page.setViewportSize({ width: 1000, height: 800 });
  await seed();
  await page.screenshot({ path: "/tmp/vs-policy-slice5/light-1000.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await seed();
  await page.screenshot({ path: "/tmp/vs-policy-slice5/dark-1000.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en-US/settings/vs-membership-minimums");
  await seed();
  await page.screenshot({ path: "/tmp/vs-policy-slice5/mobile-390.png", fullPage: true });
  await page.goto("/pt-BR/settings/vs-membership-minimums");
  await page.screenshot({ path: "/tmp/vs-policy-slice5/pt-br-390.png", fullPage: true });
});
