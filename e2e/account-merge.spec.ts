import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createHqUserOnly,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Account merge", () => {
  test("target account merges source with accepted invite membership", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MG${nanoid(3)}`,
      name: "Merge Alliance",
    });
    const sourceEmail = `source-${nanoid(6)}@alliance-hq.test`;
    const targetEmail = `target-${nanoid(6)}@alliance-hq.test`;

    const sourceUser = await createHqUserOnly(sql, sourceEmail);
    await createAllianceMembership(sql, {
      hqUserId: sourceUser.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });

    const targetSession = await createAuthenticatedHqSession(sql, targetEmail);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: targetSession.sessionId,
        nextAuthToken: targetSession.nextAuthToken,
      }),
    );

    const requestRes = await page.request.post(
      "/api/user/account-merge/request-source-proof",
      { data: { sourceEmail } },
    );
    expect(requestRes.ok()).toBeTruthy();

    const confirmRes = await page.request.post("/api/user/account-merge/confirm", {
      data: { sourceEmail, code: "424242" },
    });
    expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

    const [sourceRow] = await sql<{ id: string }[]>`
      SELECT id FROM hq_users WHERE id = ${sourceUser.hqUserId}
    `;
    expect(sourceRow).toBeUndefined();

    const [membership] = await sql<{ hq_user_id: string }[]>`
      SELECT hq_user_id
      FROM alliance_memberships
      WHERE alliance_id = ${alliance.allianceId}
        AND hq_user_id = ${targetSession.hqUserId}
      LIMIT 1
    `;
    expect(membership?.hq_user_id).toBe(targetSession.hqUserId);
  });

  test("settings page exposes combine accounts UI", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MG${nanoid(3)}`,
      name: "Merge Settings Alliance",
    });
    const email = `merge-settings-${nanoid(6)}@alliance-hq.test`;
    const session = await createAuthenticatedHqSession(sql, email);
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${session.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: session.sessionId,
        nextAuthToken: session.nextAuthToken,
      }),
    );

    await page.goto("/settings/account");

    await expect(page.getByRole("heading", { name: /Combine accounts/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Send verification code/i }).nth(1),
    ).toBeVisible();
  });
});
