import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
  authCookieHeader,
  createAuthenticatedHqSession,
  createHqInviteRow,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  loadMembershipRoleName,
  playwrightAuthCookies,
  simulateManualMembershipAshedUpgrade,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("Invite API — role-member regression", () => {
  test("creates member invite with /trains redirect via admin API", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `M${nanoid(4)}`,
      name: "E2E Native Alliance",
    });

    const email = `member-${nanoid(6)}@e2e.test`;
    const res = await request.post(
      `/api/admin/native-alliances/${alliance.allianceId}/invites`,
      {
        headers: {
          Cookie: authCookieHeader(maintainer),
        },
        data: {
          email,
          roleName: "member",
          redirectPath: "/trains",
        },
      },
    );

    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as { invite?: { inviteUrl: string } };
    expect(body.invite?.inviteUrl).toContain("/invite/");
  });
});

test.describe("Invite onboarding — member link before destination", () => {
  test("member accept lands on onboard with invite redirect", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MB${nanoid(3)}`,
      name: "Member Onboarding Alliance",
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
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/onboard/);
    await expect(page).toHaveURL(/next=%2Ftrains|next=\/trains/);
    await expect(page.getByText(alliance.name)).toBeVisible();
  });

  test("member with member link reaches invite destination", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MD${nanoid(3)}`,
      name: "Member Default Redirect Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(accepted));
    await page.goto("/members");

    await expect(page).toHaveURL(/\/members$/);
    await expect(page).not.toHaveURL(/\/onboard/);
  });

  test("officer accept requires Ashed verification before member link", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OF${nanoid(3)}`,
      name: "Officer Onboarding Alliance",
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
      page.getByRole("heading", { name: /verify with ashed first/i }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/\/trains/);
  });

  test("officer without Ashed sees connect CTA on onboard", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `OH${nanoid(3)}`,
      name: "Officer Header Alliance",
    });
    const email = `officer-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "officer",
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);

    await page.context().addCookies(playwrightAuthCookies(accepted));
    await page.goto("/onboard");

    await expect(
      page.getByRole("link", { name: /connect ashed/i }),
    ).toBeVisible();
  });
});

test.describe("Member access — no Ashed embeds until connected", () => {
  test("member without Ashed connection cannot open iframe routes", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MI${nanoid(3)}`,
      name: "Member Iframe Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      redirectPath: "/members",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(accepted));
    await page.goto("/members");

    // Native alliances hide iframe nav; footer external link is always present.
    await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: /open ashed/i })).toHaveCount(
      1,
    );

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/members/);
  });

  test("member can attempt Ashed connect (not blocked by member role)", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MC${nanoid(3)}`,
      name: "Member Connect Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);

    const res = await request.post("/api/auth/connect", {
      headers: {
        Cookie: `alliance_hq_session=${accepted.sessionId}`,
      },
      data: {
        input: "authorization: Bearer not-a-real-token",
      },
    });

    const body = (await res.json()) as { code?: string };
    expect(body.code).not.toBe("connect_not_allowed_for_member");
  });

  test("member account keeps Ashed connect section available", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MS${nanoid(3)}`,
      name: "Member Settings Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(accepted));
    await page.goto("/account");

    await expect(page.getByText(/reconnect to refresh your token/i)).toBeVisible();
  });

  test("native member with Ashed credential can open embed routes but not sidebar iframe nav", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MC${nanoid(3)}`,
      name: "Member Connected Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: accepted.hqUserId,
    });
    const ashedUserId = `ashed-${nanoid(12)}`;
    await sql`
      UPDATE hq_users
      SET ashed_user_id = ${ashedUserId}
      WHERE id = ${accepted.hqUserId}
    `;
    await attachAshedConnectionToSession(sql, accepted.sessionId, {
      ashedUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(accepted));
    await page.goto("/members");

    await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(
      0,
    );
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/account");
    await expect(page.getByText(/remind me/i)).toBeVisible();
  });

  test("manual member membership upgrades on higher Ashed role attestation", async () => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `MU${nanoid(3)}`,
      name: "Member Upgrade Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);

    expect(accepted.hqUserId).toBeTruthy();

    expect(
      await loadMembershipRoleName(
        sql,
        accepted.hqUserId,
        alliance.allianceId,
      ),
    ).toBe("member");

    const upgraded = await simulateManualMembershipAshedUpgrade(
      sql,
      accepted.hqUserId,
      alliance.allianceId,
      "officer",
    );
    expect(upgraded).toBe(true);
    expect(
      await loadMembershipRoleName(
        sql,
        accepted.hqUserId,
        alliance.allianceId,
      ),
    ).toBe("officer");
  });
});

test.describe("Platform maintainer — Ashed embed access with live verification", () => {
  test("maintainer with live Ashed sees iframe nav and can open dashboard route", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    await attachAshedConnectionToSession(sql, maintainer.sessionId);

    await page.context().addCookies(playwrightAuthCookies(maintainer));

    await page.goto("/members");
    await expect(page.getByRole("link", { name: /^dashboard$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /admin portal/i })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
