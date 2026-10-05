import { expect, test } from "@playwright/test";

import { getE2eSql, playwrightAuthCookies } from "./fixtures/db";
import { setupVsMembersFixture } from "./fixtures/vs-members";

async function memberIdByName(sql: ReturnType<typeof getE2eSql>, allianceId: string, name: string) {
  const [row] = await sql`SELECT ashed_member_id FROM alliance_members WHERE alliance_id = ${allianceId} AND current_name = ${name}`;
  return row.ashed_member_id as string;
}

test("score editor screenshots", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await request.get("/api/vs-compliance", { headers: officer.headers });
  const meetingId = await memberIdByName(f.sql, f.alliance.allianceId, "VSM Meeting");
  await page.context().addCookies(playwrightAuthCookies(officer));
  await page.goto(`/vs-performance/members/${meetingId}?week=${f.weekStart}`);
  await page.getByTestId("vs-member-score-editor").waitFor();
  const editor = page.getByTestId("vs-member-score-editor");
  await editor.getByTestId(`vs-score-input-daily:${f.days[0]}`).fill("5");
  await editor.getByTestId("vs-score-reason").fill("Screenshot pass");
  await page.screenshot({ path: "/tmp/vs-members-slice4/light-1000.png", fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: "/tmp/vs-members-slice4/dark-1000.png", fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await expect(page.getByTestId("vs-member-score-editor")).toBeVisible();
  await page.screenshot({ path: "/tmp/vs-members-slice4/mobile-390.png", fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
