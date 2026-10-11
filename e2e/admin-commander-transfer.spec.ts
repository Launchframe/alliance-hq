import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  linkNativeAllianceToGameServer,
} from "./fixtures/db";

type Sql = ReturnType<typeof getE2eSql>;

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function hqSessionOnlyCookie(sessionId: string): string {
  return `alliance_hq_session=${sessionId}`;
}

function parseAllianceHqSessionId(setCookieHeader: string | undefined): string {
  const match = setCookieHeader?.match(/alliance_hq_session=([^;]+)/);
  if (!match?.[1]) throw new Error("Missing alliance_hq_session in Set-Cookie");
  return match[1];
}

async function mintSessionViaBootstrap(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", {
    maxRedirects: 0,
  });
  expect(bootstrap.status()).toBeGreaterThanOrEqual(300);
  expect(bootstrap.status()).toBeLessThan(400);
  return parseAllianceHqSessionId(bootstrap.headers()["set-cookie"]);
}

function randomGameUid(): string {
  return `9${randomBytes(6).readUIntBE(0, 6).toString().padStart(15, "0")}`;
}

async function seedTransferScenario(sql: Sql) {
  const now = new Date();
  const source = await createNativeAlliance(sql, {
    tag: `TS${nanoid(3)}`,
    name: "Transfer Source Alliance",
  });
  await linkNativeAllianceToGameServer(sql, source.allianceId, 1211);
  const destination = await createNativeAlliance(sql, {
    tag: `TD${nanoid(3)}`,
    name: "Transfer Destination Alliance",
  });
  await linkNativeAllianceToGameServer(sql, destination.allianceId, 1249);

  const player = await createAuthenticatedHqSession(
    sql,
    `transfer-player-${nanoid(6)}@e2e.test`.toLowerCase(),
  );
  const name = `E2E Transfer ${nanoid(4)}`;
  const gameUid = randomGameUid();

  const commanderId = nanoid(16);
  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, game_uid, game_server_number,
      current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId}, ${name}, ${name.toLowerCase()}, ${gameUid}, ${1211},
      ${source.allianceId}, ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO hq_user_commanders (id, hq_user_id, commander_id, is_primary, linked_at, updated_at)
    VALUES (${nanoid(16)}, ${player.hqUserId}, ${commanderId}, true, ${now}, ${now})
  `;
  const sourceMember = await createAllianceRosterMember(sql, {
    allianceId: source.allianceId,
    currentName: name,
  });
  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)}, ${commanderId}, ${source.allianceId}, ${sourceMember.ashedMemberId},
      'active', ${now}, ${now}, ${now}
    )
  `;
  await createHqMemberLink(sql, {
    allianceId: source.allianceId,
    hqUserId: player.hqUserId,
    ashedMemberId: sourceMember.ashedMemberId,
    gameUid,
    memberDisplayName: name,
  });

  const destinationMember = await createAllianceRosterMember(sql, {
    allianceId: destination.allianceId,
    currentName: name,
  });
  const duplicateCommanderId = nanoid(16);
  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, game_server_number,
      current_alliance_id, created_at, updated_at
    ) VALUES (
      ${duplicateCommanderId}, ${name}, ${name.toLowerCase()}, ${1249},
      ${destination.allianceId}, ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)}, ${duplicateCommanderId}, ${destination.allianceId},
      ${destinationMember.ashedMemberId}, 'active', ${now}, ${now}, ${now}
    )
  `;
  const levelEventId = nanoid(16);
  await sql`
    INSERT INTO commander_level_events (id, commander_id, total, source, alliance_id, created_at)
    VALUES (${levelEventId}, ${duplicateCommanderId}, 30, 'e2e', ${destination.allianceId}, ${now})
  `;

  return {
    source,
    destination,
    player,
    gameUid,
    commanderId,
    duplicateCommanderId,
    sourceAshedMemberId: sourceMember.ashedMemberId,
    destinationAshedMemberId: destinationMember.ashedMemberId,
    levelEventId,
  };
}

type Scenario = Awaited<ReturnType<typeof seedTransferScenario>>;

function transferBody(scenario: Scenario, dryRun: boolean) {
  return {
    hqUserId: scenario.player.hqUserId,
    commanderId: scenario.commanderId,
    destinationAllianceId: scenario.destination.allianceId,
    destinationAshedMemberId: scenario.destinationAshedMemberId,
    dryRun,
  };
}

async function levelEventOwner(sql: Sql, id: string): Promise<string | undefined> {
  const [row] = await sql<{ commander_id: string }[]>`
    SELECT commander_id FROM commander_level_events WHERE id = ${id}
  `;
  return row?.commander_id;
}

test.describe("Admin commander server transfer", () => {
  test("maintainer previews then transfers a commander to another server", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await seedTransferScenario(sql);
    const maintainer = await createPlatformMaintainerSession(sql);
    const headers = { Cookie: authCookieHeader(maintainer) };

    const candidates = await request.get(
      `${e2eBaseUrl()}/api/admin/commander-transfer?allianceId=${scenario.destination.allianceId}`,
      { headers },
    );
    expect(candidates.status()).toBe(200);
    const candidateBody = (await candidates.json()) as {
      members: Array<{ ashedMemberId: string }>;
    };
    expect(candidateBody.members.map((m) => m.ashedMemberId)).toContain(
      scenario.destinationAshedMemberId,
    );

    const preview = await request.post(`${e2eBaseUrl()}/api/admin/commander-transfer`, {
      headers,
      data: transferBody(scenario, true),
    });
    const previewText = await preview.text();
    expect(preview.status(), previewText).toBe(200);
    expect(previewText).not.toContain(scenario.gameUid);
    const previewBody = JSON.parse(previewText) as {
      summary: { fromServer: number; toServer: number; historyCount: number };
    };
    expect(previewBody.summary).toMatchObject({
      fromServer: 1211,
      toServer: 1249,
      historyCount: 1,
    });
    expect(await levelEventOwner(sql, scenario.levelEventId)).toBe(
      scenario.duplicateCommanderId,
    );

    const transfer = await request.post(`${e2eBaseUrl()}/api/admin/commander-transfer`, {
      headers,
      data: transferBody(scenario, false),
    });
    const transferText = await transfer.text();
    expect(transfer.status(), transferText).toBe(200);
    expect(transferText).not.toContain(scenario.gameUid);

    const [commander] = await sql<
      { game_server_number: number | null; current_alliance_id: string | null }[]
    >`
      SELECT game_server_number, current_alliance_id FROM commanders
      WHERE id = ${scenario.commanderId}
    `;
    expect(commander?.game_server_number).toBe(1249);
    expect(commander?.current_alliance_id).toBe(scenario.destination.allianceId);

    const [membership] = await sql<{ commander_id: string; status: string }[]>`
      SELECT commander_id, status FROM commander_alliance_memberships
      WHERE alliance_id = ${scenario.destination.allianceId}
        AND ashed_member_id = ${scenario.destinationAshedMemberId}
    `;
    expect(membership?.commander_id).toBe(scenario.commanderId);
    expect(membership?.status).toBe("active");

    expect(await levelEventOwner(sql, scenario.levelEventId)).toBe(scenario.commanderId);

    const [duplicate] = await sql<{ game_uid: string | null; current_alliance_id: string | null }[]>`
      SELECT game_uid, current_alliance_id FROM commanders
      WHERE id = ${scenario.duplicateCommanderId}
    `;
    expect(duplicate?.game_uid).toBeNull();
    expect(duplicate?.current_alliance_id).toBeNull();

    const [destinationLink] = await sql<{ ashed_member_id: string }[]>`
      SELECT ashed_member_id FROM hq_member_links
      WHERE alliance_id = ${scenario.destination.allianceId}
        AND hq_user_id = ${scenario.player.hqUserId}
    `;
    expect(destinationLink?.ashed_member_id).toBe(scenario.destinationAshedMemberId);

    const [sourceLink] = await sql<{ ashed_member_id: string }[]>`
      SELECT ashed_member_id FROM hq_member_links
      WHERE alliance_id = ${scenario.source.allianceId}
        AND hq_user_id = ${scenario.player.hqUserId}
    `;
    expect(sourceLink?.ashed_member_id).toBe(scenario.sourceAshedMemberId);

    const [audit] = await sql<{ metadata: Record<string, unknown> | null }[]>`
      SELECT metadata FROM audit_log
      WHERE alliance_id = ${scenario.destination.allianceId}
        AND action = 'commander_server_transferred'
      LIMIT 1
    `;
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit?.metadata)).not.toContain(scenario.gameUid);
  });

  test("bootstrap session cannot list candidates or transfer", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await seedTransferScenario(sql);
    const sessionId = await mintSessionViaBootstrap(request);
    const headers = { Cookie: hqSessionOnlyCookie(sessionId) };

    const list = await request.get(
      `${e2eBaseUrl()}/api/admin/commander-transfer?allianceId=${scenario.destination.allianceId}`,
      { headers },
    );
    expect(list.status(), await list.text()).toBe(403);

    const res = await request.post(`${e2eBaseUrl()}/api/admin/commander-transfer`, {
      headers,
      data: transferBody(scenario, false),
    });
    expect(res.status(), await res.text()).toBe(403);
    expect(await levelEventOwner(sql, scenario.levelEventId)).toBe(
      scenario.duplicateCommanderId,
    );
  });

  test("signed-in non-maintainer gets 403", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await seedTransferScenario(sql);
    const headers = { Cookie: authCookieHeader(scenario.player) };

    const list = await request.get(
      `${e2eBaseUrl()}/api/admin/commander-transfer?allianceId=${scenario.destination.allianceId}`,
      { headers },
    );
    expect(list.status(), await list.text()).toBe(403);

    const res = await request.post(`${e2eBaseUrl()}/api/admin/commander-transfer`, {
      headers,
      data: transferBody(scenario, false),
    });
    expect(res.status(), await res.text()).toBe(403);

    const [commander] = await sql<{ game_server_number: number | null }[]>`
      SELECT game_server_number FROM commanders WHERE id = ${scenario.commanderId}
    `;
    expect(commander?.game_server_number).toBe(1211);
  });

  test("destination already claimed by another account is refused", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await seedTransferScenario(sql);
    const other = await createAuthenticatedHqSession(
      sql,
      `transfer-other-${nanoid(6)}@e2e.test`.toLowerCase(),
    );
    await createHqMemberLink(sql, {
      allianceId: scenario.destination.allianceId,
      hqUserId: other.hqUserId,
      ashedMemberId: scenario.destinationAshedMemberId,
    });
    const maintainer = await createPlatformMaintainerSession(sql);

    const res = await request.post(`${e2eBaseUrl()}/api/admin/commander-transfer`, {
      headers: { Cookie: authCookieHeader(maintainer) },
      data: transferBody(scenario, false),
    });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe(
      "destination_member_claimed",
    );
    expect(await levelEventOwner(sql, scenario.levelEventId)).toBe(
      scenario.duplicateCommanderId,
    );
  });
});
