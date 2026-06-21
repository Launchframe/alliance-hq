import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createCanonicalAshedHqUser,
  createHqInviteRow,
  createHqUserOnly,
  createMagicLinkSession,
  createNativeAlliance,
  createPlatformMaintainerSession,
  fetchConnectSessionState,
  getE2eSql,
  playwrightAuthCookies,
  sessionCookie,
  sessionHasAshedCredential,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

test.describe("Browser session isolation — Ashed credential binding", () => {
  test("disconnecting Ashed removes credential and embed access", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DC${nanoid(3)}`,
      name: "Disconnect Alliance",
    });
    const session = await createAuthenticatedHqSession(sql, uniqueEmail("connected"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${session.sessionId}
    `;
    await attachAshedConnectionToSession(sql, session.sessionId);

    expect(
      await fetchConnectSessionState(e2eBaseUrl(), session.sessionId),
    ).toMatchObject({ isConnected: true, canUseAshedEmbeds: true });

    const disconnect = await request.post("/api/auth/disconnect", {
      headers: {
        Cookie: `alliance_hq_session=${session.sessionId}`,
      },
    });
    expect(disconnect.ok()).toBeTruthy();

    expect(await sessionHasAshedCredential(sql, session.sessionId)).toBe(false);
    expect(
      await fetchConnectSessionState(e2eBaseUrl(), session.sessionId),
    ).toMatchObject({ isConnected: false, canUseAshedEmbeds: false });
  });

  test("invite accept clears stale Ashed credential from prior browser user", async () => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `IS${nanoid(3)}`,
      name: "Invite Isolation Alliance",
    });
    const priorUser = await createAuthenticatedHqSession(sql, uniqueEmail("prior"));
    await createAllianceMembership(sql, {
      hqUserId: priorUser.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await attachAshedConnectionToSession(sql, priorUser.sessionId);
    expect(await sessionHasAshedCredential(sql, priorUser.sessionId)).toBe(true);

    const inviteEmail = uniqueEmail("invited");
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email: inviteEmail,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const accepted = await acceptInviteViaApi(
      sql,
      e2eBaseUrl(),
      token,
      inviteEmail,
      undefined,
      priorUser.sessionId,
    );

    expect(accepted.hqUserId).not.toBe(priorUser.hqUserId);
    expect(await sessionHasAshedCredential(sql, priorUser.sessionId)).toBe(false);
    expect(
      await fetchConnectSessionState(e2eBaseUrl(), priorUser.sessionId),
    ).toMatchObject({ isConnected: false });
  });

  test("member accepting invite on stale-cred session cannot open embed routes", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `IE${nanoid(3)}`,
      name: "Embed Isolation Alliance",
    });
    const priorUser = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("officer-prior"),
    );
    await attachAshedConnectionToSession(sql, priorUser.sessionId);

    const inviteEmail = uniqueEmail("member-new");
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email: inviteEmail,
      roleName: "member",
      redirectPath: "/members",
      invitedByHqUserId: maintainer.hqUserId,
    });

    await acceptInviteViaApi(
      sql,
      e2eBaseUrl(),
      token,
      inviteEmail,
      undefined,
      priorUser.sessionId,
    );

    await page.context().addCookies([sessionCookie(priorUser.sessionId)]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/members/);
  });

  test("different HQ user signing in on same browser session clears stale Ashed cred", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `SI${nanoid(3)}`,
      name: "Session Isolation Alliance",
    });
    const ashedUserId = `ashed-${nanoid(12)}`;

    const userA = await createMagicLinkSession(sql, uniqueEmail("user-a"));
    const { hqUserId: canonicalA } = await createCanonicalAshedHqUser(sql, {
      email: uniqueEmail("canonical-a"),
      ashedUserId,
    });
    await createAllianceMembership(sql, {
      hqUserId: canonicalA,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "ashed",
    });

    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalA}, current_alliance_id = ${alliance.allianceId}
      WHERE id = ${userA.sessionId}
    `;
    await attachAshedConnectionToSession(sql, userA.sessionId, { ashedUserId });

    expect(
      await fetchConnectSessionState(e2eBaseUrl(), userA.sessionId),
    ).toMatchObject({ isConnected: true, roleName: "officer" });

    const userB = await createHqUserOnly(sql, uniqueEmail("user-b"));

    await page.context().addCookies([
      {
        name: "alliance_hq_session",
        value: userA.sessionId,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "authjs.session-token",
        value: userB.nextAuthToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/account");

    expect(await sessionHasAshedCredential(sql, userA.sessionId)).toBe(false);
    expect(
      await fetchConnectSessionState(e2eBaseUrl(), userA.sessionId),
    ).toMatchObject({ isConnected: false, roleName: null });

    const [sessionRow] = await sql<{ hq_user_id: string | null }[]>`
      SELECT hq_user_id FROM sessions WHERE id = ${userA.sessionId} LIMIT 1
    `;
    expect(sessionRow?.hq_user_id).toBe(userB.hqUserId);
  });

  test("same HQ user re-authenticating preserves Ashed credential on browser session", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const ashedUserId = `ashed-${nanoid(12)}`;
    const user = await createMagicLinkSession(sql, uniqueEmail("same-user"));

    await sql`
      UPDATE hq_users
      SET ashed_user_id = ${ashedUserId}
      WHERE id = ${user.hqUserId}
    `;
    await attachAshedConnectionToSession(sql, user.sessionId, { ashedUserId });

    expect(
      await fetchConnectSessionState(e2eBaseUrl(), user.sessionId),
    ).toMatchObject({ isConnected: true });

    await page.context().addCookies(playwrightAuthCookies(user));
    await page.goto("/account");

    expect(await sessionHasAshedCredential(sql, user.sessionId)).toBe(true);
    expect(
      await fetchConnectSessionState(e2eBaseUrl(), user.sessionId),
    ).toMatchObject({ isConnected: true });
  });
});
