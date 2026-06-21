import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAuthenticatedHqSession,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  sessionCookie,
} from "./fixtures/db";

test.describe("App access routing", () => {
  test("signed-in user without membership is redirected to /connect from app routes", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const auth = await createAuthenticatedHqSession(
      sql,
      `lonely-${nanoid(6)}@e2e.test`,
      { accessGranted: false },
    );

    await page.context().addCookies([sessionCookie(auth.sessionId)]);
    await page.goto("/members");

    await expect(page).toHaveURL(/\/connect/);
  });
});

test.describe("Post-invite routing", () => {
  test("invite onboarding skip lands on destination, not /connect", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `PR${nanoid(3)}`,
      name: "Post Invite Routing Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/connect\?welcome=1/);
    await page.getByRole("link", { name: /continue without ashed/i }).click();

    await expect(page).toHaveURL(/\/trains/);
    await expect(page).not.toHaveURL(/\/connect$/);
  });

  test("invite accept without redirect skips to /members by default", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `PD${nanoid(3)}`,
      name: "Post Invite Default Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/connect\?welcome=1/);
    await page.getByRole("link", { name: /continue without ashed/i }).click();

    await expect(page).toHaveURL(/\/members$/);
    await expect(page).not.toHaveURL(/\/connect$/);
  });
});
