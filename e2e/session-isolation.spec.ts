import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  fetchConnectSessionState,
  getE2eSql,
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
});
