import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  attachAshedConnectionToSession,
  createAllianceMembership,
  createCanonicalAshedHqUser,
  createHqInviteRow,
  createMagicLinkSession,
  createNativeAlliance,
  createPlatformMaintainerSession,
  fetchConnectSessionState,
  getE2eSql,
  loadMembershipRoleName,
  sessionCookie,
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
  test("magic-link stub cannot inherit Ashed officer role without canonical session binding", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `AB${nanoid(3)}`,
      name: "Ashed Boost Guard Alliance",
    });
    const ashedUserId = `ashed-${nanoid(12)}`;
    const ashedEmail = uniqueEmail("ashed-player");

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

    const email = uniqueEmail("magic-stub");
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

    await attachAshedConnectionToSession(sql, accepted.sessionId, { ashedUserId });

    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${accepted.sessionId}
    `;

    const state = await fetchConnectSessionState(
      e2eBaseUrl(),
      accepted.sessionId,
    );

    expect(state.isConnected).toBe(true);
    expect(state.roleName).toBe("member");
    expect(state.canUseAshedEmbeds).toBe(true);

    expect(
      await loadMembershipRoleName(
        sql,
        sessionRow!.hq_user_id,
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

    expect(await sessionHasAshedCredential(sql, sessionA.sessionId)).toBe(false);
    expect(await sessionHasAshedCredential(sql, sessionB.sessionId)).toBe(true);
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
    expect(disconnected.roleName).toBe("officer");
  });
});
