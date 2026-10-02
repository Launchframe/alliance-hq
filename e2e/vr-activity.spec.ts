import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  type Sql,
} from "./fixtures/db";

const createdCommanderIds: string[] = [];
const createdPendingHqUserIds: string[] = [];

test.afterEach(async () => {
  const sql = getE2eSql();
  const pendingUserIds = createdPendingHqUserIds.splice(0);
  if (pendingUserIds.length > 0) {
    await sql`DELETE FROM hq_vr_pending WHERE hq_user_id = ANY(${pendingUserIds})`;
  }
  const ids = createdCommanderIds.splice(0);
  if (ids.length === 0) return;
  const history = await sql<{ id: string }[]>`
    SELECT id FROM commander_season_vr_events WHERE commander_id = ANY(${ids})
  `;
  await sql`
    DELETE FROM activity_events
    WHERE source_namespace = 'commander-season-vr-events'
      AND source_key = ANY(${history.map((row) => row.id)})
  `;
  await sql`DELETE FROM commander_season_vr_events WHERE commander_id = ANY(${ids})`;
  await sql`DELETE FROM commander_season_vr WHERE commander_id = ANY(${ids})`;
  await sql`DELETE FROM hq_user_commanders WHERE commander_id = ANY(${ids})`;
  await sql`DELETE FROM commander_alliance_memberships WHERE commander_id = ANY(${ids})`;
  await sql`DELETE FROM commanders WHERE id = ANY(${ids})`;
});

async function insertLinkedCommander(
  sql: Sql,
  input: { allianceId: string; ashedMemberId: string; hqUserId: string },
): Promise<{ commanderId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);
  createdCommanderIds.push(commanderId);

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId}, 'VR Activity Commander', 'vr activity commander',
      ${input.allianceId}, ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)}, ${commanderId}, ${input.allianceId},
      ${input.ashedMemberId}, 'active', ${now}, ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO hq_user_commanders (id, hq_user_id, commander_id, is_primary, linked_at, updated_at)
    VALUES (${nanoid(16)}, ${input.hqUserId}, ${commanderId}, true, ${now}, ${now})
  `;

  return { commanderId };
}

async function activityCount(sql: Sql, hqUserId: string) {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM activity_events
    WHERE personal_owner_hq_user_id = ${hqUserId}
      AND source_namespace = 'commander-season-vr-events'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function seedLinkedMember() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `VA${nanoid(3)}`,
    name: "VR Activity Alliance",
  });
  await sql`
    UPDATE alliances
    SET season_key_override = '1',
        current_season_key = '1',
        season_key_source = 'override',
        season_is_post_season = 0
    WHERE id = ${alliance.allianceId}
  `;
  const email = `vr-activity-${nanoid(6)}@e2e.test`;
  const session = await createAuthenticatedHqSession(sql, email, {
    displayName: "VR Activity User",
  });
  await createAllianceMembership(sql, {
    hqUserId: session.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "member",
    source: "manual",
  });
  const { ashedMemberId } = await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: session.hqUserId,
    memberDisplayName: "VR Activity Commander",
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    ashedMemberId,
    currentName: "VR Activity Commander",
    allianceRank: 4,
  });
  const { commanderId } = await insertLinkedCommander(sql, {
    allianceId: alliance.allianceId,
    ashedMemberId,
    hqUserId: session.hqUserId,
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${session.sessionId}
  `;
  return { sql, alliance, session, commanderId, ashedMemberId };
}

test.describe("VR submissions write activity", () => {
  test("manual submit records one web activity event and repeats are no-ops", async ({
    request,
  }) => {
    const { sql, session } = await seedLinkedMember();
    const headers = { Cookie: authCookieHeader(session) };

    const first = await request.post("/api/vr/me", {
      headers,
      data: { instituteLevel: 1 },
    });
    expect(first.status()).toBe(200);
    expect((await first.json()).status).toBe("set_vr");

    const events = await sql<
      {
        channel: string;
        method: string;
        actorKind: string;
        value: string;
        previousValue: string | null;
      }[]
    >`
      SELECT channel, method, actor_kind AS "actorKind",
             payload ->> 'value' AS value,
             payload ->> 'previousValue' AS "previousValue"
      FROM activity_events
      WHERE personal_owner_hq_user_id = ${session.hqUserId}
        AND source_namespace = 'commander-season-vr-events'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "web",
      method: "manual",
      actorKind: "hq",
      value: "100",
      previousValue: null,
    });

    const feed = await request.get("/api/activity/personal", { headers });
    expect(feed.status()).toBe(200);
    const body = await feed.json();
    const item = body.items.find(
      (entry: { eventKey: string }) => entry.eventKey === "vr.submitted",
    );
    expect(item).toMatchObject({
      channel: "web",
      method: "manual",
      values: { value: "100" },
    });

    const repeat = await request.post("/api/vr/me", {
      headers,
      data: { instituteLevel: 1 },
    });
    expect(repeat.status()).toBe(200);
    expect(await activityCount(sql, session.hqUserId)).toBe(1);
  });

  test("invalid levels and orphan confirmations create no events", async ({
    request,
  }) => {
    const { sql, session } = await seedLinkedMember();
    const headers = { Cookie: authCookieHeader(session) };

    const invalid = await request.post("/api/vr/me", {
      headers,
      data: { instituteLevel: 99 },
    });
    expect(invalid.status()).toBe(200);
    expect((await invalid.json()).status).toBe("validation_error");

    const orphanConfirm = await request.post("/api/vr/me", {
      headers,
      data: { confirm: "yes" },
    });
    expect(orphanConfirm.status()).toBe(200);
    expect((await orphanConfirm.json()).status).toBe("error");

    expect(await activityCount(sql, session.hqUserId)).toBe(0);
  });

  test("bound-session/auth mismatch and missing member link deny mutation", async ({
    request,
  }) => {
    const { sql, session, commanderId } = await seedLinkedMember();

    const other = await createAuthenticatedHqSession(
      sql,
      `vr-activity-other-${nanoid(6)}@e2e.test`,
    );
    const mismatched = await request.post("/api/vr/me", {
      headers: {
        Cookie: `alliance_hq_session=${session.sessionId}; authjs.session-token=${other.nextAuthToken}`,
      },
      data: { instituteLevel: 2 },
    });
    expect(mismatched.status()).toBe(403);

    const sessionCookieOnly = await request.post("/api/vr/me", {
      headers: { Cookie: `alliance_hq_session=${session.sessionId}` },
      data: { instituteLevel: 2 },
    });
    expect(sessionCookieOnly.status()).toBe(403);

    const unlinkedSession = await createAuthenticatedHqSession(
      sql,
      `vr-activity-solo-${nanoid(6)}@e2e.test`,
    );
    const soloAlliance = await createNativeAlliance(sql, {
      tag: `VS${nanoid(3)}`,
      name: "VR Solo Alliance",
    });
    await createAllianceMembership(sql, {
      hqUserId: unlinkedSession.hqUserId,
      allianceId: soloAlliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${soloAlliance.allianceId},
          alliance_id = ${soloAlliance.allianceId},
          alliance_tag = ${soloAlliance.tag}
      WHERE id = ${unlinkedSession.sessionId}
    `;
    const unlinked = await request.post("/api/vr/me", {
      headers: { Cookie: authCookieHeader(unlinkedSession) },
      data: { instituteLevel: 2 },
    });
    expect(unlinked.status()).toBe(403);

    expect(await activityCount(sql, session.hqUserId)).toBe(0);
    expect(await activityCount(sql, unlinkedSession.hqUserId)).toBe(0);
    const summary = await sql<{ highest: number | null }[]>`
      SELECT highest_base_vr AS highest FROM commander_season_vr
      WHERE commander_id = ${commanderId}
    `;
    expect(summary).toHaveLength(0);
  });

  test("seeded anomaly prompt writes an event on yes and nothing on no", async ({
    request,
  }) => {
    const { sql, alliance, session, commanderId, ashedMemberId } =
      await seedLinkedMember();
    const headers = { Cookie: authCookieHeader(session) };
    createdPendingHqUserIds.push(session.hqUserId);

    const seedPending = (pendingJson: Record<string, unknown>) => sql`
      INSERT INTO hq_vr_pending (alliance_id, hq_user_id, pending_json, expires_at, updated_at)
      VALUES (${alliance.allianceId}, ${session.hqUserId},
        ${sql.json(pendingJson)},
        ${new Date(Date.now() + 30 * 60 * 1000)}, ${new Date()})
      ON CONFLICT (alliance_id, hq_user_id) DO UPDATE
      SET pending_json = EXCLUDED.pending_json, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
    `;
    const pendingCount = async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM hq_vr_pending
        WHERE hq_user_id = ${session.hqUserId}
      `;
      return Number(rows[0]?.count ?? 0);
    };

    await seedPending({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId,
      commanderId,
      seasonKey: "1",
    });
    const confirmYes = await request.post("/api/vr/me", {
      headers,
      data: { confirm: "yes" },
    });
    expect(confirmYes.status()).toBe(200);
    expect((await confirmYes.json()).status).toBe("set_vr");
    expect(await pendingCount()).toBe(0);

    const events = await sql<
      { channel: string; method: string; value: string }[]
    >`
      SELECT channel, method, payload ->> 'value' AS value
      FROM activity_events
      WHERE personal_owner_hq_user_id = ${session.hqUserId}
        AND source_namespace = 'commander-season-vr-events'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "web",
      method: "manual",
      value: "8000",
    });

    await seedPending({
      kind: "anomaly_confirm",
      proposedVr: 8500,
      ashedMemberId,
      commanderId,
      seasonKey: "1",
    });
    const confirmNo = await request.post("/api/vr/me", {
      headers,
      data: { confirm: "no" },
    });
    expect(confirmNo.status()).toBe(200);
    expect((await confirmNo.json()).status).toBe("anomaly_rejected");
    expect(await activityCount(sql, session.hqUserId)).toBe(1);
    expect(await pendingCount()).toBe(0);

    await seedPending({
      kind: "anomaly_confirm",
      proposedVr: 9000,
      ashedMemberId,
      commanderId,
      seasonKey: "2",
    });
    const wrongSeason = await request.post("/api/vr/me", {
      headers,
      data: { confirm: "yes" },
    });
    expect(wrongSeason.status()).toBe(200);
    expect((await wrongSeason.json()).status).toBe("error");
    expect(await activityCount(sql, session.hqUserId)).toBe(1);

    await seedPending({
      kind: "anomaly_confirm",
      proposedVr: 9000,
      ashedMemberId,
      commanderId,
    });
    const missingSeason = await request.post("/api/vr/me", {
      headers,
      data: { confirm: "yes" },
    });
    expect(missingSeason.status()).toBe(200);
    expect((await missingSeason.json()).status).toBe("error");
    expect(await activityCount(sql, session.hqUserId)).toBe(1);

    await seedPending({
      kind: "anomaly_confirm",
      proposedVr: 9000,
      ashedMemberId,
      commanderId,
    });
    const explicit = await request.post("/api/vr/me", {
      headers,
      data: { instituteLevel: 28 },
    });
    expect(explicit.status()).toBe(200);
    expect((await explicit.json()).status).toBe("set_vr");
    expect(await activityCount(sql, session.hqUserId)).toBe(2);
    expect(await pendingCount()).toBe(0);
  });
});
