import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqInviteRow,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("Account email change", () => {
  test("signed-in user can change email via API and keep the same hq user id", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const originalEmail = `before-${nanoid(6)}@alliance-hq.test`;
    const targetEmail = `after-${nanoid(6)}@alliance-hq.test`;
    const session = await createAuthenticatedHqSession(sql, originalEmail);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: session.sessionId,
        nextAuthToken: session.nextAuthToken,
      }),
    );

    const requestRes = await page.request.post("/api/user/email-change/request", {
      data: { newEmail: targetEmail },
    });
    expect(requestRes.ok()).toBeTruthy();

    const confirmRes = await page.request.post("/api/user/email-change/confirm", {
      data: { newEmail: targetEmail, code: "424242" },
    });
    expect(confirmRes.ok()).toBeTruthy();
    const confirmBody = (await confirmRes.json()) as { email?: string };
    expect(confirmBody.email).toBe(targetEmail.toLowerCase());

    const [row] = await sql<{ id: string; email: string }[]>`
      SELECT id, email FROM hq_users WHERE id = ${session.hqUserId}
    `;
    expect(row?.id).toBe(session.hqUserId);
    expect(row?.email).toBe(targetEmail.toLowerCase());
  });

  test("invite accept succeeds after email matches invite address", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `EC${nanoid(3)}`,
      name: "Email Change Invite Alliance",
    });
    const originalEmail = `discord-${nanoid(6)}@alliance-hq.test`;
    const inviteEmail = `invite-${nanoid(6)}@alliance-hq.test`;
    const session = await createAuthenticatedHqSession(sql, originalEmail);

    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email: inviteEmail,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: session.sessionId,
        nextAuthToken: session.nextAuthToken,
      }),
    );

    await page.request.post("/api/user/email-change/request", {
      data: { newEmail: inviteEmail },
    });
    await page.request.post("/api/user/email-change/confirm", {
      data: { newEmail: inviteEmail, code: "424242" },
    });

    const acceptRes = await fetch(
      `${e2eBaseUrl()}/api/invite/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookieHeader({
            sessionId: session.sessionId,
            nextAuthToken: session.nextAuthToken,
          }),
        },
        body: JSON.stringify({
          email: inviteEmail,
          displayName: "Email Change Member",
        }),
      },
    );

    expect(acceptRes.ok).toBeTruthy();

    const [membership] = await sql<{ hq_user_id: string }[]>`
      SELECT hq_user_id
      FROM alliance_memberships
      WHERE alliance_id = ${alliance.allianceId}
        AND hq_user_id = ${session.hqUserId}
      LIMIT 1
    `;
    expect(membership?.hq_user_id).toBe(session.hqUserId);
  });

  test("settings page exposes account email change UI", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `EC${nanoid(3)}`,
      name: "Email Change Settings Alliance",
    });
    const email = `settings-${nanoid(6)}@alliance-hq.test`;
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

    await expect(page.getByRole("heading", { name: /Account email/i })).toBeVisible();
    await expect(
      page
        .getByRole("heading", { name: /Account email/i })
        .locator("..")
        .getByText(session.email, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Send verification code/i }),
    ).toBeVisible();
  });
});
