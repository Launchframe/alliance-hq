import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
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

test.describe("Member-link onboarding gate", () => {
  test("unlinked native member is redirected from app shell to /onboard", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OG${nanoid(3)}`,
      name: "Onboard Gate Alliance",
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

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/onboard/);
  });

  test("linked member reaches dashboard without onboard redirect", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OL${nanoid(3)}`,
      name: "Onboard Linked Alliance",
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
    await page.goto("/dashboard");

    await expect(page).not.toHaveURL(/\/onboard/);
  });

  test("officer without Ashed proceeds to member link on onboard", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OP${nanoid(3)}`,
      name: "Officer Privileged Onboard",
    });
    const email = `officer-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "officer",
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const auth = await createAuthenticatedHqSession(sql, email);
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/onboard/);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(
      page.getByRole("heading", { name: /link your character/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /verify with ashed first/i }),
    ).toHaveCount(0);
  });

  test("officer linked without Ashed reaches app", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OLP${nanoid(3)}`,
      name: "Officer Loop Guard Alliance",
    });
    const email = `officer-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "officer",
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
    await page.goto("/dashboard");

    await expect(page).not.toHaveURL(/\/onboard/);
  });

  test("officer with live Ashed and member link reaches app", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OFA${nanoid(3)}`,
      name: "Officer Full Access Alliance",
    });
    const email = `officer-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "officer",
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(
      sql,
      e2eBaseUrl(),
      token,
      email,
    );
    await attachAshedConnectionToSession(sql, accepted.sessionId);
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
});
