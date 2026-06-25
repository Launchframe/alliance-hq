import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
  createAllianceJoinCodeRow,
  createAuthenticatedHqSession,
  createHqInviteRow,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  getLatestPendingRosterLinkRequestId,
  insertRosterLinkAcceptToken,
  linkNativeAllianceToGameServer,
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

async function seedUnlinkedMemberOnboardSession(sql: ReturnType<typeof getE2eSql>) {
  const maintainer = await createPlatformMaintainerSession(sql);
  const alliance = await createNativeAlliance(sql, {
    tag: `OM${nanoid(3)}`,
    name: "Onboard Member Link Flow",
  });
  await linkNativeAllianceToGameServer(sql, alliance.allianceId, 1203);
  const email = `member-${nanoid(6)}@e2e.test`;
  const { token } = await createHqInviteRow(sql, {
    allianceId: alliance.allianceId,
    email,
    roleName: "member",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);
  return { accepted, email, alliance };
}

async function openMemberLinkForm(page: import("@playwright/test").Page) {
  await page.goto("/onboard");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(
    page.getByRole("heading", { name: /link your character/i }),
  ).toBeVisible();
}

test.describe("Member-link onboarding outcomes", () => {
  test("invite roster miss on wrong server returns wrong_server without owner request", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { accepted, email, alliance } =
      await seedUnlinkedMemberOnboardSession(sql);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await openMemberLinkForm(page);

    await page.getByLabel(/in-game name/i).fill("E2eWrongServer");
    await page.getByLabel(/player uid/i).fill("1234567890121205");
    const linkResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/member-link") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /link my character/i }).click();
    const response = await linkResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { outcome?: string };
    expect(body.outcome).toBe("wrong_server");

    await expect(
      page.getByRole("heading", { name: /wrong state server/i }),
    ).toBeVisible();

    const requestId = await getLatestPendingRosterLinkRequestId(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });
    expect(requestId).toBeNull();
  });

  test("wrong_server submit shows wrong-server guidance", async ({ page }) => {
    const sql = getE2eSql();
    const { accepted, email } = await seedUnlinkedMemberOnboardSession(sql);

    await page.route("**/api/member-link", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "wrong_server",
            message:
              "Your player UID is for state server 1205, but this alliance is on server 1203.",
            pending: null,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await openMemberLinkForm(page);

    await page.getByLabel(/in-game name/i).fill("Test Commander");
    await page.getByLabel(/player uid/i).fill("1234567890123");
    await page.getByRole("button", { name: /link my character/i }).click();

    await expect(
      page.getByRole("heading", { name: /wrong state server/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/state server 1205/i),
    ).toBeVisible();
  });

  test("awaiting_owner refresh transitions to linked success", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { accepted, email } = await seedUnlinkedMemberOnboardSession(sql);

    let memberLinkGets = 0;
    await page.route("**/api/member-link", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      memberLinkGets += 1;
      if (memberLinkGets === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            linked: false,
            link: null,
            pending: {
              kind: "link_awaiting_owner",
              requestId: "e2e-request",
            },
            requiresAshedVerification: false,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          linked: true,
          link: { memberDisplayName: "Approved Commander" },
          pending: null,
          requiresAshedVerification: false,
        }),
      });
    });

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await page.goto("/onboard");

    await expect(
      page.getByRole("heading", { name: /we've notified your r5/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /check again/i }).click();

    await expect(
      page.getByRole("heading", { name: /you're linked/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("connect-flow sign-out is visible on onboard", async ({ page }) => {
    const sql = getE2eSql();
    const { accepted, email } = await seedUnlinkedMemberOnboardSession(sql);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await page.goto("/onboard");

    await expect(page.getByRole("button", { name: /wrong account/i })).toBeVisible();
  });

  test("invite roster miss submits awaiting_owner without API mocks", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { accepted, email } = await seedUnlinkedMemberOnboardSession(sql);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await openMemberLinkForm(page);

    await page.getByLabel(/in-game name/i).fill("E2eRosterMiss");
    await page.getByLabel(/player uid/i).fill("1234567890121204");
    const linkResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/member-link") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /link my character/i }).click();
    const response = await linkResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { outcome?: string };
    expect(body.outcome).toBe("awaiting_owner");

    await expect(
      page.getByRole("heading", { name: /we've notified your r5/i }),
    ).toBeVisible();
  });

  test("owner accept token links invitee after roster approval", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { accepted, email, alliance } =
      await seedUnlinkedMemberOnboardSession(sql);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: accepted.sessionId,
        hqUserId: accepted.hqUserId,
        email,
        nextAuthToken: accepted.nextAuthToken,
      }),
    );
    await openMemberLinkForm(page);
    await page.getByLabel(/in-game name/i).fill("E2eRosterMiss");
    await page.getByLabel(/player uid/i).fill("1234567890121204");
    await page.getByRole("button", { name: /link my character/i }).click();
    await expect(
      page.getByRole("heading", { name: /we've notified your r5/i }),
    ).toBeVisible();

    const requestId = await getLatestPendingRosterLinkRequestId(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });
    expect(requestId).toBeTruthy();

    const acceptToken = await insertRosterLinkAcceptToken(sql, {
      requestId: requestId!,
    });
    const ownerResponse = await page.request.get(
      `/api/roster-link-requests/action?token=${encodeURIComponent(acceptToken)}`,
    );
    expect(ownerResponse.ok()).toBe(true);
    await expect(ownerResponse.text()).resolves.toMatch(/approved|member approved/i);

    const [memberLink] = await sql<{ game_uid: string }[]>`
      SELECT game_uid FROM hq_member_links
      WHERE alliance_id = ${alliance.allianceId}
        AND hq_user_id = ${accepted.hqUserId}
      LIMIT 1
    `;
    expect(memberLink?.game_uid).toBe("1234567890121204");

    const [rosterMember] = await sql<{ current_name: string }[]>`
      SELECT current_name FROM alliance_members
      WHERE alliance_id = ${alliance.allianceId}
        AND current_name = 'E2eRosterMiss'
      LIMIT 1
    `;
    expect(rosterMember?.current_name).toBe("E2eRosterMiss");

    await page.getByRole("button", { name: /check again/i }).click();
    await expect(
      page.getByRole("heading", { name: /you're linked/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("join-code owner cold-starts first roster member on empty native alliance", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OC${nanoid(3)}`,
      name: "Owner Cold Start Alliance",
    });
    await linkNativeAllianceToGameServer(sql, alliance.allianceId, 1203);
    const { code } = await createAllianceJoinCodeRow(sql, {
      allianceId: alliance.allianceId,
      roleName: "owner",
      maxRedemptions: 1,
      createdByHqUserId: maintainer.hqUserId,
    });

    const email = `owner-cold-${nanoid(6)}@e2e.test`;
    const auth = await createAuthenticatedHqSession(sql, email);

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto("/join");
    await page.getByLabel(/join code/i).fill(code);
    await page.getByRole("button", { name: /join alliance/i }).click();
    await expect(page).toHaveURL(/\/onboard/);

    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/in-game name/i).fill("ColdStartOwner");
    await page.getByLabel(/player uid/i).fill("1234567890121203");
    const linkResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/member-link") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /link my character/i }).click();
    const response = await linkResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { outcome?: string; message?: string };
    expect(body.outcome, body.message ?? "no message").toBe("linked");

    await expect(
      page.getByRole("heading", { name: /you're linked/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
