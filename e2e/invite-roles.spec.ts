import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  loadMembershipRoleName,
  sessionCookie,
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
          Cookie: `alliance_hq_session=${maintainer.sessionId}`,
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

test.describe("Invite onboarding — connect welcome before destination", () => {
  test("member accept shows welcome, skip lands on invite redirect", async ({
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

    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/connect\?welcome=1/);
    await expect(page).toHaveURL(/next=%2Ftrains|next=\/trains/);
    await expect(page.getByRole("heading", { name: /you're in/i })).toBeVisible();

    await page.getByRole("link", { name: /continue without ashed/i }).click();
    await expect(page).toHaveURL(/\/trains/);
  });

  test("member accept without redirect skips to /members by default", async ({
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

    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/connect\?welcome=1/);
    await page.getByRole("link", { name: /continue without ashed/i }).click();
    await expect(page).toHaveURL(/\/members$/);
  });

  test("officer accept shows welcome then skip lands on invite redirect", async ({
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

    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/connect\?welcome=1/);
    await page.getByRole("link", { name: /continue without ashed/i }).click();
    await expect(page).toHaveURL(/\/trains/);
  });

  test("officer without Ashed connection can open connect flow from settings", async ({
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

    const accepted = await acceptInviteViaApi(e2eBaseUrl(), token, email);

    await page.context().addCookies([sessionCookie(accepted.sessionId)]);
    await page.goto("/settings");

    await expect(page.getByText(/reconnect to refresh your token/i)).toBeVisible();
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

    const accepted = await acceptInviteViaApi(e2eBaseUrl(), token, email);

    await page.context().addCookies([sessionCookie(accepted.sessionId)]);
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

    const accepted = await acceptInviteViaApi(e2eBaseUrl(), token, email);

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

  test("member settings keeps Ashed connect section available", async ({
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

    const accepted = await acceptInviteViaApi(e2eBaseUrl(), token, email);

    await page.context().addCookies([sessionCookie(accepted.sessionId)]);
    await page.goto("/settings");

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

    const accepted = await acceptInviteViaApi(e2eBaseUrl(), token, email);
    await attachAshedConnectionToSession(sql, accepted.sessionId);

    await page.context().addCookies([sessionCookie(accepted.sessionId)]);
    await page.goto("/members");

    await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(
      0,
    );
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/settings");
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

    const accepted = await acceptInviteViaApi(e2eBaseUrl(), token, email);

    const [sessionRow] = await sql<{ hq_user_id: string }[]>`
      SELECT hq_user_id
      FROM sessions
      WHERE id = ${accepted.sessionId}
      LIMIT 1
    `;
    expect(sessionRow?.hq_user_id).toBeTruthy();

    expect(
      await loadMembershipRoleName(
        sql,
        sessionRow!.hq_user_id,
        alliance.allianceId,
      ),
    ).toBe("member");

    const upgraded = await simulateManualMembershipAshedUpgrade(
      sql,
      sessionRow!.hq_user_id,
      alliance.allianceId,
      "officer",
    );
    expect(upgraded).toBe(true);
    expect(
      await loadMembershipRoleName(
        sql,
        sessionRow!.hq_user_id,
        alliance.allianceId,
      ),
    ).toBe("officer");
  });
});

test.describe("Platform maintainer — Ashed embed access without connect", () => {
  test("maintainer sees iframe nav and can open dashboard route", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);

    await page.context().addCookies([sessionCookie(maintainer.sessionId)]);

    await page.goto("/members");
    await expect(page.getByRole("link", { name: /^dashboard$/i })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
