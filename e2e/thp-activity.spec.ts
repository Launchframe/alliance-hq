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
    await sql`DELETE FROM hq_thp_pending WHERE hq_user_id = ANY(${pendingUserIds})`;
  }
  const ids = createdCommanderIds.splice(0);
  if (ids.length === 0) return;
  const history = await sql<{ id: string }[]>`
    SELECT id FROM commander_thp_events WHERE commander_id = ANY(${ids})
  `;
  await sql`
    DELETE FROM activity_events
    WHERE source_namespace = 'commander-thp-events'
      AND source_key = ANY(${history.map((row) => row.id)})
  `;
  await sql`DELETE FROM commander_thp_events WHERE commander_id = ANY(${ids})`;
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
      ${commanderId}, 'THP Activity Commander', 'thp activity commander',
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
      AND source_namespace = 'commander-thp-events'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function seedLinkedMember() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `TA${nanoid(3)}`,
    name: "THP Activity Alliance",
  });
  const email = `thp-activity-${nanoid(6)}@e2e.test`;
  const session = await createAuthenticatedHqSession(sql, email, {
    displayName: "THP Activity User",
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
    memberDisplayName: "THP Activity Commander",
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    ashedMemberId,
    currentName: "THP Activity Commander",
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
  return { sql, alliance, session, commanderId };
}

test.describe("THP submissions write activity", () => {
  test("manual submit records one web activity event and repeats are no-ops", async ({
    request,
  }) => {
    const { sql, session } = await seedLinkedMember();
    const headers = { Cookie: authCookieHeader(session) };

    const first = await request.post("/api/thp/me/submit", {
      headers,
      data: { total: 125_000_000 },
    });
    expect(first.status()).toBe(200);
    expect((await first.json()).status).toBe("set_thp");

    const events = await sql<
      {
        channel: string;
        method: string;
        actorKind: string;
        value: string;
      }[]
    >`
      SELECT channel, method, actor_kind AS "actorKind",
             payload ->> 'value' AS value
      FROM activity_events
      WHERE personal_owner_hq_user_id = ${session.hqUserId}
        AND source_namespace = 'commander-thp-events'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "web",
      method: "manual",
      actorKind: "hq",
      value: "125000000",
    });

    const feed = await request.get("/api/activity/personal", { headers });
    expect(feed.status()).toBe(200);
    const body = await feed.json();
    const item = body.items.find(
      (entry: { eventKey: string }) => entry.eventKey === "thp.submitted",
    );
    expect(item).toMatchObject({
      channel: "web",
      method: "manual",
      values: { value: "125000000" },
    });

    const repeat = await request.post("/api/thp/me/submit", {
      headers,
      data: { total: 125_000_000 },
    });
    expect(repeat.status()).toBe(200);
    expect(await activityCount(sql, session.hqUserId)).toBe(1);
  });

  test("invalid totals and orphan confirmations create no events", async ({
    request,
  }) => {
    const { sql, session } = await seedLinkedMember();
    const headers = { Cookie: authCookieHeader(session) };

    const invalid = await request.post("/api/thp/me/submit", {
      headers,
      data: { total: 2_000_000_000 },
    });
    expect(invalid.status()).toBe(200);
    expect((await invalid.json()).status).toBe("validation_error");

    const orphanConfirm = await request.post("/api/thp/me/submit", {
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
      `thp-activity-other-${nanoid(6)}@e2e.test`,
    );
    const mismatched = await request.post("/api/thp/me/submit", {
      headers: {
        Cookie: `alliance_hq_session=${session.sessionId}; authjs.session-token=${other.nextAuthToken}`,
      },
      data: { total: 130_000_000 },
    });
    expect(mismatched.status()).toBe(403);

    const sessionCookieOnly = await request.post("/api/thp/me/submit", {
      headers: { Cookie: `alliance_hq_session=${session.sessionId}` },
      data: { total: 130_000_000 },
    });
    expect(sessionCookieOnly.status()).toBe(403);

    const unlinkedSession = await createAuthenticatedHqSession(
      sql,
      `thp-activity-solo-${nanoid(6)}@e2e.test`,
    );
    await seedSharedAlliance(sql, unlinkedSession);
    const unlinked = await request.post("/api/thp/me/submit", {
      headers: { Cookie: authCookieHeader(unlinkedSession) },
      data: { total: 130_000_000 },
    });
    expect(unlinked.status()).toBe(403);

    expect(await activityCount(sql, session.hqUserId)).toBe(0);
    expect(await activityCount(sql, unlinkedSession.hqUserId)).toBe(0);
    const commander = await sql<{ total: number | null }[]>`
      SELECT current_total_hero_power AS total FROM commanders
      WHERE id = ${commanderId}
    `;
    expect(commander[0]?.total).toBeNull();
  });

  test("seeded confirm prompt writes a screenshot event on yes and nothing on no", async ({
    request,
  }) => {
    const { sql, alliance, session, commanderId } = await seedLinkedMember();
    const headers = { Cookie: authCookieHeader(session) };
    createdPendingHqUserIds.push(session.hqUserId);

    const seedPending = (proposedTotal: number) => sql`
      INSERT INTO hq_thp_pending (alliance_id, hq_user_id, pending_json, expires_at, updated_at)
      VALUES (${alliance.allianceId}, ${session.hqUserId},
        ${sql.json({ kind: "ocr_confirm", proposedTotal, proposedBreakdown: null, commanderId })},
        ${new Date(Date.now() + 30 * 60 * 1000)}, ${new Date()})
      ON CONFLICT (alliance_id, hq_user_id) DO UPDATE
      SET pending_json = EXCLUDED.pending_json, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
    `;
    const pendingCount = async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM hq_thp_pending
        WHERE hq_user_id = ${session.hqUserId}
      `;
      return Number(rows[0]?.count ?? 0);
    };

    await seedPending(160_000_000);
    const confirmYes = await request.post("/api/thp/me/submit", {
      headers,
      data: { confirm: "yes" },
    });
    expect(confirmYes.status()).toBe(200);
    expect((await confirmYes.json()).status).toBe("set_thp");
    expect(await pendingCount()).toBe(0);

    const events = await sql<
      { channel: string; method: string; value: string }[]
    >`
      SELECT channel, method, payload ->> 'value' AS value
      FROM activity_events
      WHERE personal_owner_hq_user_id = ${session.hqUserId}
        AND source_namespace = 'commander-thp-events'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "web",
      method: "screenshot",
      value: "160000000",
    });

    await seedPending(165_000_000);
    const confirmNo = await request.post("/api/thp/me/submit", {
      headers,
      data: { confirm: "no" },
    });
    expect(confirmNo.status()).toBe(200);
    expect((await confirmNo.json()).status).toBe("anomaly_rejected");
    expect(await activityCount(sql, session.hqUserId)).toBe(1);
    expect(await pendingCount()).toBe(0);
  });
});

async function seedSharedAlliance(sql: Sql, session: { hqUserId: string; sessionId: string }) {
  const alliance = await createNativeAlliance(sql, {
    tag: `TW${nanoid(3)}`,
    name: "THP Workspace Alliance",
  });
  await createAllianceMembership(sql, {
    hqUserId: session.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "member",
    source: "manual",
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${session.sessionId}
  `;
  return { alliance };
}
