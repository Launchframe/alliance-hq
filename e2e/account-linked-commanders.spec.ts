import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

test("account page lists linked commanders and unlinks the owner's claim", async ({
  page,
  context,
}) => {
  const sql = getE2eSql();
  const { allianceId } = await createNativeAlliance(sql, {
    tag: `LC${randomUUID().slice(0, 6)}`,
    name: "Linked commanders",
  });
  const user = await createAuthenticatedHqSession(
    sql,
    `${randomUUID()}@e2e.test`,
  );
  await createAllianceMembership(sql, {
    allianceId,
    hqUserId: user.hqUserId,
    roleName: "member",
    source: "manual",
  });
  const member = await createAllianceRosterMember(sql, {
    allianceId,
    currentName: "Linked Alpha",
    allianceRank: 3,
  });
  await createHqMemberLink(sql, {
    allianceId,
    hqUserId: user.hqUserId,
    ashedMemberId: member.ashedMemberId,
    memberDisplayName: "Stale Link Name",
  });
  await sql`UPDATE sessions SET current_alliance_id=${allianceId}, alliance_id=${allianceId} WHERE id=${user.sessionId}`;

  await context.addCookies(playwrightAuthCookies(user));
  await page.addLocatorHandler(
    page.getByTestId("hq-release-notes-drawer"),
    async () => {
      await page.getByTestId("hq-release-notes-dismiss").click();
    },
  );

  await page.goto("/account");
  const card = page.getByRole("region", { name: "My Linked Commanders" });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Link another commander" }),
  ).toBeVisible();
  await expect(card.getByText("Linked Alpha")).toBeVisible();
  await expect(card.getByText("Stale Link Name")).toHaveCount(0);

  await card.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(card.getByText("Unlink this Commander?")).toBeVisible();
  await card.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(card.getByText("You have not linked a commander yet.")).toBeVisible();

  const remaining = await sql`
    SELECT id FROM hq_member_links
    WHERE alliance_id = ${allianceId} AND hq_user_id = ${user.hqUserId}
  `;
  expect(remaining).toHaveLength(0);
});
