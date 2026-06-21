import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  attachAshedConnectionToSession,
  authCookieHeader,
  createAllianceMembership,
  createCanonicalAshedHqUser,
  createMagicLinkSession,
  createNativeAlliance,
  fetchConnectSessionState,
  getE2eSql,
  loadMembershipRoleName,
  sessionHasAshedCredential,
} from "./fixtures/db";
import { rebindAshedIdentityForE2e } from "./fixtures/rebind-ashed-identity";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

test.describe("Ashed identity rebind — permission boost prevention", () => {
  test("session with Ashed cred resolves RBAC to canonical HQ user", async () => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `AB${nanoid(3)}`,
      name: "Ashed Boost Guard Alliance",
    });
    const ashedUserId = `ashed-${nanoid(12)}`;

    const { hqUserId: canonicalId } = await createCanonicalAshedHqUser(sql, {
      email: uniqueEmail("ashed-player"),
      ashedUserId,
    });
    await createAllianceMembership(sql, {
      hqUserId: canonicalId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "ashed",
    });

    const stubSession = await createMagicLinkSession(sql, uniqueEmail("magic-stub"));
    await createAllianceMembership(sql, {
      hqUserId: stubSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });

    await attachAshedConnectionToSession(sql, stubSession.sessionId, { ashedUserId });

    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalId}, current_alliance_id = ${alliance.allianceId}
      WHERE id = ${stubSession.sessionId}
    `;

    const state = await fetchConnectSessionState(
      e2eBaseUrl(),
      stubSession.sessionId,
    );

    expect(state.isConnected).toBe(true);
    expect(state.roleName).toBe("officer");
    expect(state.canUseAshedEmbeds).toBe(true);

    expect(
      await loadMembershipRoleName(
        sql,
        stubSession.hqUserId,
        alliance.allianceId,
      ),
    ).toBe("member");
    expect(
      await loadMembershipRoleName(
        sql,
        canonicalId,
        alliance.allianceId,
      ),
    ).toBe("officer");
  });

  test("second browser session rebind removes first session Ashed credential and orphan boost", async () => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `RB${nanoid(3)}`,
      name: "Rebind Alliance",
    });
    const ashedUserId = `ashed-${nanoid(12)}`;
    const ashedEmail = uniqueEmail("shared-ashed");

    const sessionA = await createMagicLinkSession(sql, uniqueEmail("magic-a"));
    const sessionB = await createMagicLinkSession(sql, uniqueEmail("magic-b"));

    await createAllianceMembership(sql, {
      hqUserId: sessionA.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });

    const { hqUserId: canonicalId } = await createCanonicalAshedHqUser(sql, {
      email: ashedEmail,
      ashedUserId,
    });
    await createAllianceMembership(sql, {
      hqUserId: canonicalId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "ashed",
    });

    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalId}, current_alliance_id = ${alliance.allianceId}
      WHERE id = ${sessionA.sessionId}
    `;
    await attachAshedConnectionToSession(sql, sessionA.sessionId, {
      ashedUserId,
    });

    await attachAshedConnectionToSession(sql, sessionB.sessionId, {
      ashedUserId,
    });
    await createAllianceMembership(sql, {
      hqUserId: sessionB.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "ashed",
    });

    await rebindAshedIdentityForE2e(sql, {
      ashedUserId,
      canonicalHqUserId: canonicalId,
      sessionId: sessionB.sessionId,
      mergedFromHqUserId: sessionB.hqUserId,
      allianceId: alliance.allianceId,
    });

    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalId}, current_alliance_id = ${alliance.allianceId}
      WHERE id = ${sessionB.sessionId}
    `;

    expect(await sessionHasAshedCredential(sql, sessionA.sessionId)).toBe(false);
    expect(await sessionHasAshedCredential(sql, sessionB.sessionId)).toBe(true);

    const loserState = await fetchConnectSessionState(
      e2eBaseUrl(),
      sessionA.sessionId,
    );
    expect(loserState.isConnected).toBe(false);
    expect(loserState.roleName).toBeNull();

    const winnerState = await fetchConnectSessionState(
      e2eBaseUrl(),
      sessionB.sessionId,
    );
    expect(winnerState.isConnected).toBe(true);
    expect(winnerState.roleName).toBe("officer");
    expect(
      await loadMembershipRoleName(
        sql,
        sessionB.hqUserId,
        alliance.allianceId,
      ),
    ).toBeNull();
    expect(
      await loadMembershipRoleName(
        sql,
        canonicalId,
        alliance.allianceId,
      ),
    ).toBe("officer");
  });

  test("disconnecting Ashed removes embed access until reconnect", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DC${nanoid(3)}`,
      name: "Disconnect Alliance",
    });
    const ashedUserId = `ashed-${nanoid(12)}`;

    const session = await createMagicLinkSession(sql, uniqueEmail("connected"));
    const { hqUserId: canonicalId } = await createCanonicalAshedHqUser(sql, {
      email: uniqueEmail("canonical"),
      ashedUserId,
    });

    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalId}, current_alliance_id = ${alliance.allianceId}
      WHERE id = ${session.sessionId}
    `;
    await createAllianceMembership(sql, {
      hqUserId: canonicalId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "ashed",
    });
    await attachAshedConnectionToSession(sql, session.sessionId, {
      ashedUserId,
    });

    const connected = await fetchConnectSessionState(
      e2eBaseUrl(),
      session.sessionId,
    );
    expect(connected.isConnected).toBe(true);
    expect(connected.canUseAshedEmbeds).toBe(true);
    expect(connected.roleName).toBe("officer");

    const disconnect = await request.post("/api/auth/disconnect", {
      headers: {
        Cookie: `alliance_hq_session=${session.sessionId}`,
      },
    });
    expect(disconnect.ok()).toBeTruthy();

    expect(await sessionHasAshedCredential(sql, session.sessionId)).toBe(false);

    const disconnected = await fetchConnectSessionState(
      e2eBaseUrl(),
      session.sessionId,
    );
    expect(disconnected.isConnected).toBe(false);
    expect(disconnected.canUseAshedEmbeds).toBe(false);
    expect(disconnected.roleName).toBeNull();
  });

  test("sign-out clears Ashed credential from browser session", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const ashedUserId = `ashed-${nanoid(12)}`;
    const session = await createMagicLinkSession(sql, uniqueEmail("sign-out"));
    const { hqUserId: canonicalId } = await createCanonicalAshedHqUser(sql, {
      email: uniqueEmail("canonical-sign-out"),
      ashedUserId,
    });

    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalId}
      WHERE id = ${session.sessionId}
    `;
    await attachAshedConnectionToSession(sql, session.sessionId, {
      ashedUserId,
    });

    expect(
      await fetchConnectSessionState(e2eBaseUrl(), session.sessionId),
    ).toMatchObject({ isConnected: true });

    const signOut = await request.post("/api/auth/sign-out", {
      headers: {
        Cookie: authCookieHeader(session),
      },
    });
    expect(signOut.ok()).toBeTruthy();

    expect(await sessionHasAshedCredential(sql, session.sessionId)).toBe(false);
    expect(
      await fetchConnectSessionState(e2eBaseUrl(), session.sessionId),
    ).toMatchObject({ isConnected: false });
  });
});
