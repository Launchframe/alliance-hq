import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
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

test.describe("App access routing", () => {
  test("signed-in user without membership is redirected to /get-started from app routes", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const auth = await createAuthenticatedHqSession(
      sql,
      `lonely-${nanoid(6)}@e2e.test`,
      { accessGranted: false },
    );

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto("/members");

    await expect(page).toHaveURL(/\/get-started/);
  });
});

test.describe("Post-invite routing", () => {
  test("invite accept redirects to member-link onboarding before destination", async ({
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

    const auth = await createAuthenticatedHqSession(sql, email);

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/onboard/);
    await expect(page).toHaveURL(/next=%2Ftrains|next=\/trains/);
    await expect(
      page.getByRole("button", { name: /continue/i }),
    ).toBeVisible();
  });

  test("member with hq_member_links row reaches invite destination", async ({
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
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(
      sql,
      e2eBaseUrl(),
      token,
      email,
    );
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await page.goto("/trains");

    await expect(page).toHaveURL(/\/trains/);
    await expect(page).not.toHaveURL(/\/onboard/);
  });

  test("invite accept without redirect lands on onboard then members after link", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `PM${nanoid(3)}`,
      name: "Post Invite Members Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(
      sql,
      e2eBaseUrl(),
      token,
      email,
    );
    expect(accepted.redirectTo).toMatch(/\/onboard/);

    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await page.goto("/members");

    await expect(page).toHaveURL(/\/members$/);
    await expect(page).not.toHaveURL(/\/onboard/);
  });
});
