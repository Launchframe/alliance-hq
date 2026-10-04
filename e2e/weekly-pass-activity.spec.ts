import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import en from "../messages/en-US.json";
import pt from "../messages/pt-BR.json";

import {
  authCookieHeader,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
  type Sql,
} from "./fixtures/db";

const createdCommanderIds: string[] = [];
const createdAllianceIds: string[] = [];

test.afterEach(async () => {
  const sql = getE2eSql();
  const allianceIds = createdAllianceIds.splice(0);
  if (allianceIds.length > 0) {
    await sql`
      DELETE FROM activity_events
      WHERE source_namespace = 'commander-weekly-pass'
        AND alliance_id = ANY(${allianceIds})
    `;
  }
  const ids = createdCommanderIds.splice(0);
  if (ids.length === 0) return;
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
      ${commanderId}, 'WP Activity Commander', 'wp activity commander',
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

async function activityCount(sql: Sql, allianceId: string) {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM activity_events
    WHERE source_namespace = 'commander-weekly-pass'
      AND alliance_id = ${allianceId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function seedLinkedMember(input: {
  tagPrefix: string;
  roleName: "member" | "officer";
  alliance?: { allianceId: string; tag: string };
}) {
  const sql = getE2eSql();
  const alliance =
    input.alliance ??
    (await createNativeAlliance(sql, {
      tag: `${input.tagPrefix}${nanoid(3)}`,
      name: "WP Activity Alliance",
    }));
  createdAllianceIds.push(alliance.allianceId);
  const email = `wp-activity-${nanoid(6)}@e2e.test`;
  const session = await createAuthenticatedHqSession(sql, email, {
    displayName: "WP Activity User",
  });
  await createAllianceMembership(sql, {
    hqUserId: session.hqUserId,
    allianceId: alliance.allianceId,
    roleName: input.roleName,
    source: "manual",
  });
  const { ashedMemberId } = await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: session.hqUserId,
    memberDisplayName: "WP Activity Commander",
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    ashedMemberId,
    currentName: "WP Activity Commander",
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

test.describe("weekly pass writes activity", () => {
  test("self enable, repeat, and disable write events and render in the feed", async ({
    request,
    page,
  }) => {
    const { sql, alliance, session, commanderId } = await seedLinkedMember({
      tagPrefix: "WA",
      roleName: "member",
    });
    const headers = { Cookie: authCookieHeader(session) };

    const enable = await request.post("/api/vr/weekly-pass", {
      headers,
      data: { active: true },
    });
    expect(enable.status()).toBe(200);
    expect((await enable.json()).ok).toBe(true);

    const commander = await sql<
      { active: boolean; source: string; updatedAt: Date | null }[]
    >`
      SELECT weekly_pass_active AS active, weekly_pass_source AS source,
             weekly_pass_updated_at AS "updatedAt"
      FROM commanders WHERE id = ${commanderId}
    `;
    expect(commander[0]).toMatchObject({ active: true, source: "self" });
    expect(commander[0]?.updatedAt).not.toBeNull();

    const repeat = await request.post("/api/vr/weekly-pass", {
      headers,
      data: { active: true },
    });
    expect(repeat.status()).toBe(200);
    expect(await activityCount(sql, alliance.allianceId)).toBe(1);

    const disable = await request.post("/api/vr/weekly-pass", {
      headers,
      data: { active: false },
    });
    expect(disable.status()).toBe(200);
    expect(await activityCount(sql, alliance.allianceId)).toBe(2);

    const events = await sql<
      { channel: string; method: string; actorKind: string }[]
    >`
      SELECT channel, method, actor_kind AS "actorKind"
      FROM activity_events
      WHERE source_namespace = 'commander-weekly-pass'
        AND alliance_id = ${alliance.allianceId}
      ORDER BY occurred_at
    `;
    for (const event of events) {
      expect(event).toMatchObject({
        channel: "web",
        method: "manual",
        actorKind: "hq",
      });
    }

    const feed = await request.get("/api/activity/personal", { headers });
    expect(feed.status()).toBe(200);
    const body = await feed.json();
    const items = body.items.filter(
      (entry: { eventKey: string }) =>
        entry.eventKey === "member.weekly_pass_updated",
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({
        descriptor: "updated",
        resource: "memberProfile",
        channel: "web",
        method: "manual",
      });
    }

    await page.context().addCookies(playwrightAuthCookies(session));
    for (const [localePath, messages] of [
      ["", en],
      ["/pt-BR", pt],
    ] as const) {
      await page.goto(`${localePath}/activity`);
      const rows = page.locator("[data-testid^='activity-item-']");
      await expect(rows).toHaveCount(2);
      const sentence = messages.activity.events.updated
        .replace("{actor}", messages.activity.you)
        .replace("{resource}", messages.activity.resources.memberProfile);
      await expect(page.getByText(sentence, { exact: true })).toHaveCount(2);
      await expect(
        rows.getByText(messages.activity.channel.web, { exact: true }),
      ).toHaveCount(2);
      await expect(
        rows.getByText(messages.activity.method.manual, { exact: true }),
      ).toHaveCount(2);
    }
  });

  test("officer write is attributed to the officer, not the target", async ({
    request,
  }) => {
    const { sql, alliance, session: officerSession, commanderId: officerCommanderId } =
      await seedLinkedMember({ tagPrefix: "WO", roleName: "officer" });
    const target = await seedLinkedMember({
      tagPrefix: "WT",
      roleName: "member",
      alliance,
    });

    const response = await request.post("/api/vr/officer/weekly-pass", {
      headers: { Cookie: authCookieHeader(officerSession) },
      data: { ashedMemberId: target.ashedMemberId, active: true },
    });
    expect(response.status()).toBe(200);

    const commander = await sql<{ active: boolean; source: string }[]>`
      SELECT weekly_pass_active AS active, weekly_pass_source AS source
      FROM commanders WHERE id = ${target.commanderId}
    `;
    expect(commander[0]).toMatchObject({ active: true, source: "officer" });

    const events = await sql<
      { originalHqUserId: string; actorCommanderId: string }[]
    >`
      SELECT original_hq_user_id AS "originalHqUserId",
             actor_commander_id AS "actorCommanderId"
      FROM activity_events
      WHERE source_namespace = 'commander-weekly-pass'
        AND alliance_id = ${alliance.allianceId}
    `;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      originalHqUserId: officerSession.hqUserId,
      actorCommanderId: officerCommanderId,
    });
  });

  test("member without write permission cannot use the officer route", async ({
    request,
  }) => {
    const { sql, alliance, session } = await seedLinkedMember({
      tagPrefix: "WM",
      roleName: "member",
    });
    const target = await seedLinkedMember({
      tagPrefix: "WN",
      roleName: "member",
      alliance,
    });

    const response = await request.post("/api/vr/officer/weekly-pass", {
      headers: { Cookie: authCookieHeader(session) },
      data: { ashedMemberId: target.ashedMemberId, active: true },
    });
    expect(response.status()).toBe(403);

    const commander = await sql<{ active: boolean }[]>`
      SELECT weekly_pass_active AS active
      FROM commanders WHERE id = ${target.commanderId}
    `;
    expect(commander[0]?.active).toBe(false);
    expect(await activityCount(sql, alliance.allianceId)).toBe(0);
  });

  test("identity mismatch and workspace-only cookies deny both routes; unlinked self denied", async ({
    request,
  }) => {
    const { sql, alliance, session, ashedMemberId } = await seedLinkedMember({
      tagPrefix: "WB",
      roleName: "officer",
    });

    const other = await createAuthenticatedHqSession(
      sql,
      `wp-activity-other-${nanoid(6)}@e2e.test`,
    );

    const deniedBodies: unknown[] = [];
    const mismatchedSelf = await request.post("/api/vr/weekly-pass", {
      headers: {
        Cookie: `alliance_hq_session=${session.sessionId}; authjs.session-token=${other.nextAuthToken}`,
      },
      data: { active: true },
    });
    expect(mismatchedSelf.status()).toBe(403);
    deniedBodies.push(await mismatchedSelf.json());
    const mismatchedOfficer = await request.post(
      "/api/vr/officer/weekly-pass",
      {
        headers: {
          Cookie: `alliance_hq_session=${session.sessionId}; authjs.session-token=${other.nextAuthToken}`,
        },
        data: { ashedMemberId, active: true },
      },
    );
    expect(mismatchedOfficer.status()).toBe(403);
    deniedBodies.push(await mismatchedOfficer.json());

    const workspaceSelf = await request.post("/api/vr/weekly-pass", {
      headers: { Cookie: `alliance_hq_session=${session.sessionId}` },
      data: { active: true },
    });
    expect(workspaceSelf.status()).toBe(403);
    deniedBodies.push(await workspaceSelf.json());
    const workspaceOfficer = await request.post(
      "/api/vr/officer/weekly-pass",
      {
        headers: { Cookie: `alliance_hq_session=${session.sessionId}` },
        data: { ashedMemberId, active: true },
      },
    );
    expect(workspaceOfficer.status()).toBe(403);
    deniedBodies.push(await workspaceOfficer.json());

    for (const body of deniedBodies) {
      expect(body).toMatchObject({ error: en.activity.accessChanged });
    }

    const unlinkedSession = await createAuthenticatedHqSession(
      sql,
      `wp-activity-solo-${nanoid(6)}@e2e.test`,
    );
    const soloAlliance = await createNativeAlliance(sql, {
      tag: `WS${nanoid(3)}`,
      name: "WP Solo Alliance",
    });
    createdAllianceIds.push(soloAlliance.allianceId);
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
    const unlinked = await request.post("/api/vr/weekly-pass", {
      headers: { Cookie: authCookieHeader(unlinkedSession) },
      data: { active: true },
    });
    expect(unlinked.status()).toBe(403);

    expect(await activityCount(sql, alliance.allianceId)).toBe(0);
    expect(await activityCount(sql, soloAlliance.allianceId)).toBe(0);

    const control = await request.post("/api/vr/officer/weekly-pass", {
      headers: { Cookie: authCookieHeader(session) },
      data: { ashedMemberId, active: true },
    });
    expect(control.status()).toBe(200);
    expect(await activityCount(sql, alliance.allianceId)).toBe(1);
  });

  test("foreign targets are rejected", async ({ request }) => {
    const { sql, alliance, session: officerSession } = await seedLinkedMember({
      tagPrefix: "WF",
      roleName: "officer",
    });
    const foreign = await seedLinkedMember({
      tagPrefix: "WX",
      roleName: "member",
    });

    const response = await request.post("/api/vr/officer/weekly-pass", {
      headers: { Cookie: authCookieHeader(officerSession) },
      data: { ashedMemberId: foreign.ashedMemberId, active: true },
    });
    expect(response.status()).toBe(404);

    const commander = await sql<{ active: boolean }[]>`
      SELECT weekly_pass_active AS active
      FROM commanders WHERE id = ${foreign.commanderId}
    `;
    expect(commander[0]?.active).toBe(false);
    expect(await activityCount(sql, alliance.allianceId)).toBe(0);
    expect(await activityCount(sql, foreign.alliance.allianceId)).toBe(0);
  });
});
