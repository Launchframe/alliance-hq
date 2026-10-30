import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import type { RosterDuplicateScan } from "../src/lib/members/roster-duplicate-groups.shared";
import {
  authCookieHeader,
  createAshedAlliance,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

/**
 * October 2026 Caos roster, scaled into this database without production
 * names or player UIDs except the two near-match shapes the matcher is
 * built for (one extra character, and a shorter name contained in a longer
 * one). Production had an Ashed-linked alliance, no bot credential, 73 exact
 * pairs of an older hq-native LastRank row (stats) and a newer thin Ashed
 * row, one HQ link on a LastRank copy, unmatched LastRank rows, and unmatched
 * Ashed rows that must not be offered for removal.
 */
type Sql = ReturnType<typeof getE2eSql>;

const LAST_RANK_CREATED = new Date("2026-10-08T07:05:00.000Z");
const ASHED_CREATED = new Date("2026-10-24T00:38:00.000Z");
const EXACT_PAIR_COUNT = 73;

type CaosFixture = {
  allianceId: string;
  tag: string;
  linkedLastRankId: string;
  linkedAshedId: string;
  linkedHqUserId: string;
  punctuationLastRankId: string;
  reviewDistanceLastRankId: string;
  reviewDistanceAshedId: string;
  reviewContainedLastRankId: string;
  reviewContainedAshedId: string;
  realTwinFoldId: string;
  realTwinKeeperId: string;
  soloLastRankId: string;
  onlyAshedId: string;
};

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function insertRosterSide(
  sql: Sql,
  input: {
    allianceId: string;
    remoteAshedAllianceId: string;
    ashedMemberId: string;
    name: string;
    createdAt: Date;
    synthetic: boolean;
    stats: boolean;
    lastrankPublicId: number | null;
    serverNumber: number | null;
  },
): Promise<void> {
  const commanderId = nanoid(16);
  const normalized = input.name.trim().toLowerCase().replace(/\s+/g, " ");
  await sql`
    INSERT INTO alliance_members (
      id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
      previous_names_json, status, synced_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${input.allianceId},
      ${input.ashedMemberId},
      ${input.synthetic ? `hq-native:${input.allianceId}` : input.remoteAshedAllianceId},
      ${input.name},
      ${sql.json([])},
      'active',
      ${input.createdAt},
      ${input.createdAt},
      ${input.createdAt}
    )
  `;
  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, game_server_number,
      lastrank_public_id, profession, professional_level, member_level,
      power_level, current_total_hero_power, level_updated_at, thp_updated_at,
      current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.name},
      ${normalized},
      ${input.serverNumber},
      ${input.lastrankPublicId},
      ${input.stats ? "Engineer" : null},
      ${input.stats ? 12 : null},
      ${input.stats ? 30 : null},
      ${input.stats ? "120.5M" : null},
      ${input.stats ? 4_500_000 : null},
      ${input.stats ? input.createdAt : null},
      ${input.stats ? input.createdAt : null},
      ${input.allianceId},
      ${input.createdAt},
      ${input.createdAt}
    )
  `;
  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${commanderId},
      ${input.allianceId},
      ${input.ashedMemberId},
      'active',
      ${input.createdAt},
      ${input.createdAt},
      ${input.createdAt}
    )
  `;
}

async function seedCaosRoster(sql: Sql): Promise<CaosFixture> {
  const tag = `E2C${hex(2)}`;
  const alliance = await createAshedAlliance(sql, {
    tag,
    name: "Caos shaped roster",
  });
  const remoteAshedAllianceId = `e2e-ashed-${nanoid(10)}`;
  await sql`
    UPDATE alliances
    SET ashed_alliance_id = ${remoteAshedAllianceId}, operating_mode = 'ashed'
    WHERE id = ${alliance.allianceId}
  `;

  const linkedLastRankId = nanoid(16);
  const linkedAshedId = nanoid(16);
  const linkedUser = await createAuthenticatedHqSession(
    sql,
    `caos-link-${nanoid(6)}@e2e.test`,
  );
  // LastRank rows share one server and a null player id, matching production.
  // The orphan-name index is global, so each seed needs its own server or a
  // second fixture collides with the first on the same display names.
  const lastRankServer = 80_000 + randomBytes(2).readUInt16BE(0);

  for (let index = 0; index < EXACT_PAIR_COUNT; index += 1) {
    const name = `Caos Exact ${index}`;
    const lastRankId = index === 0 ? linkedLastRankId : nanoid(16);
    const ashedId = index === 0 ? linkedAshedId : nanoid(16);
    await insertRosterSide(sql, {
      allianceId: alliance.allianceId,
      remoteAshedAllianceId,
      ashedMemberId: lastRankId,
      name,
      createdAt: new Date(LAST_RANK_CREATED.getTime() + index),
      synthetic: true,
      stats: true,
      lastrankPublicId: 910_000 + index,
      serverNumber: lastRankServer,
    });
    await insertRosterSide(sql, {
      allianceId: alliance.allianceId,
      remoteAshedAllianceId,
      ashedMemberId: ashedId,
      name,
      createdAt: new Date(ASHED_CREATED.getTime() + index),
      synthetic: false,
      stats: false,
      lastrankPublicId: null,
      serverNumber: null,
    });
  }

  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: linkedUser.hqUserId,
    ashedMemberId: linkedLastRankId,
    memberDisplayName: "Caos Exact 0",
  });

  const punctuationLastRankId = nanoid(16);
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: punctuationLastRankId,
    name: "Nico-Pell",
    createdAt: LAST_RANK_CREATED,
    synthetic: true,
    stats: true,
    lastrankPublicId: 920_001,
    serverNumber: lastRankServer,
  });
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: nanoid(16),
    name: "Nico Pell",
    createdAt: ASHED_CREATED,
    synthetic: false,
    stats: false,
    lastrankPublicId: null,
    serverNumber: null,
  });

  const reviewDistanceLastRankId = nanoid(16);
  const reviewDistanceAshedId = nanoid(16);
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: reviewDistanceLastRankId,
    name: "Aleeaaaa",
    createdAt: LAST_RANK_CREATED,
    synthetic: true,
    stats: true,
    lastrankPublicId: 920_002,
    serverNumber: lastRankServer,
  });
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: reviewDistanceAshedId,
    name: "Aleeaaaaa",
    createdAt: ASHED_CREATED,
    synthetic: false,
    stats: false,
    lastrankPublicId: null,
    serverNumber: null,
  });

  const reviewContainedLastRankId = nanoid(16);
  const reviewContainedAshedId = nanoid(16);
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: reviewContainedLastRankId,
    name: "Gennysaur",
    createdAt: LAST_RANK_CREATED,
    synthetic: true,
    stats: true,
    lastrankPublicId: 920_003,
    serverNumber: lastRankServer,
  });
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: reviewContainedAshedId,
    name: "QMOX Gennysaur",
    createdAt: ASHED_CREATED,
    synthetic: false,
    stats: false,
    lastrankPublicId: null,
    serverNumber: null,
  });

  const realTwinFoldId = nanoid(16);
  const realTwinKeeperId = nanoid(16);
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: realTwinKeeperId,
    name: "Real Twin",
    createdAt: LAST_RANK_CREATED,
    synthetic: false,
    stats: false,
    lastrankPublicId: null,
    serverNumber: null,
  });
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: realTwinFoldId,
    name: "Real Twin",
    createdAt: ASHED_CREATED,
    synthetic: false,
    stats: false,
    lastrankPublicId: null,
    serverNumber: null,
  });

  const soloLastRankId = nanoid(16);
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: soloLastRankId,
    name: "Solo LastRank",
    createdAt: LAST_RANK_CREATED,
    synthetic: true,
    stats: true,
    lastrankPublicId: 920_004,
    serverNumber: lastRankServer,
  });
  const onlyAshedId = nanoid(16);
  await insertRosterSide(sql, {
    allianceId: alliance.allianceId,
    remoteAshedAllianceId,
    ashedMemberId: onlyAshedId,
    name: "Only Ashed",
    createdAt: ASHED_CREATED,
    synthetic: false,
    stats: false,
    lastrankPublicId: null,
    serverNumber: null,
  });

  const [credentials] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM alliance_ashed_credentials
    WHERE alliance_id = ${alliance.allianceId}
  `;
  if (Number(credentials?.n) !== 0) {
    throw new Error("Caos fixture must not install a bot credential");
  }

  return {
    allianceId: alliance.allianceId,
    tag,
    linkedLastRankId,
    linkedAshedId,
    linkedHqUserId: linkedUser.hqUserId,
    punctuationLastRankId,
    reviewDistanceLastRankId,
    reviewDistanceAshedId,
    reviewContainedLastRankId,
    reviewContainedAshedId,
    realTwinFoldId,
    realTwinKeeperId,
    soloLastRankId,
    onlyAshedId,
  };
}

async function memberStatus(
  sql: Sql,
  allianceId: string,
  ashedMemberId: string,
): Promise<string | undefined> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM alliance_members
    WHERE alliance_id = ${allianceId} AND ashed_member_id = ${ashedMemberId}
  `;
  return row?.status;
}

test.describe("Caos-shaped roster duplicate cleanup", () => {
  test.describe.configure({ timeout: 180_000 });

  test("maintainer scan and merge match the production split, without a bot credential", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const fixture = await seedCaosRoster(sql);
    const outsider = await createAuthenticatedHqSession(
      sql,
      `caos-outsider-${nanoid(6)}@e2e.test`,
    );
    const maintainer = await createPlatformMaintainerSession(sql);
    const outsiderHeaders = { Cookie: authCookieHeader(outsider) };
    const headers = { Cookie: authCookieHeader(maintainer) };
    const url = `/api/admin/alliances/${fixture.allianceId}/roster-duplicates`;

    const denied = await request.get(url, { headers: outsiderHeaders });
    expect(denied.status(), await denied.text()).toBe(403);
    const deniedPost = await request.post(url, {
      headers: outsiderHeaders,
      data: { action: "merge", ashedMemberIds: [fixture.linkedLastRankId] },
    });
    expect(deniedPost.status(), await deniedPost.text()).toBe(403);

    const scanResponse = await request.get(url, { headers });
    const scanText = await scanResponse.text();
    expect(scanResponse.status(), scanText).toBe(200);
    expect(scanText).not.toMatch(/"gameUid"/);
    const scan = JSON.parse(scanText) as RosterDuplicateScan;
    expect(scan.hasBotCredential).toBe(false);

    const exact = scan.groups.filter((group) => group.kind === "exact");
    const review = scan.groups.filter((group) => group.kind === "review");
    expect(exact).toHaveLength(EXACT_PAIR_COUNT + 2);
    expect(review).toHaveLength(2);
    expect(scan.unmatchedLastRank.map((member) => member.name)).toEqual([
      "Solo LastRank",
    ]);
    expect(JSON.stringify(scan)).not.toContain("Only Ashed");

    const linkedGroup = exact.find((group) =>
      group.members.some((member) => member.ashedMemberId === fixture.linkedLastRankId),
    );
    expect(linkedGroup?.keeperAshedMemberId).toBe(fixture.linkedAshedId);
    const linkedFold = linkedGroup?.members.find(
      (member) => member.ashedMemberId === fixture.linkedLastRankId,
    );
    expect(linkedFold).toMatchObject({
      synthetic: true,
      linkedAccount: true,
      defaultChecked: true,
      keeper: false,
      powerLevel: "120.5M",
    });
    const linkedKeeper = linkedGroup?.members.find(
      (member) => member.ashedMemberId === fixture.linkedAshedId,
    );
    expect(linkedKeeper).toMatchObject({
      synthetic: false,
      linkedAccount: false,
      defaultChecked: false,
      keeper: true,
      powerLevel: null,
    });

    const distance = review.find((group) =>
      group.members.some((member) => member.name === "Aleeaaaa"),
    );
    expect(distance?.keeperAshedMemberId).toBe(fixture.reviewDistanceAshedId);
    expect(distance?.members.every((member) => member.defaultChecked === false)).toBe(
      true,
    );

    const checked = scan.groups
      .flatMap((group) => group.members)
      .filter((member) => member.defaultChecked)
      .map((member) => member.ashedMemberId);
    expect(checked).toContain(fixture.linkedLastRankId);
    expect(checked).toContain(fixture.punctuationLastRankId);
    expect(checked).toContain(fixture.realTwinFoldId);
    expect(checked).not.toContain(fixture.reviewDistanceLastRankId);

    const inexact = await request.post(url, {
      headers,
      data: {
        action: "merge",
        ashedMemberIds: [
          fixture.reviewDistanceLastRankId,
          fixture.reviewContainedLastRankId,
        ],
      },
    });
    expect(inexact.status(), await inexact.text()).toBe(409);
    expect(await memberStatus(sql, fixture.allianceId, fixture.reviewDistanceLastRankId)).toBe(
      "active",
    );

    const merged = await request.post(url, {
      headers,
      timeout: 170_000,
      data: { action: "merge", ashedMemberIds: checked },
    });
    const mergedText = await merged.text();
    expect(merged.status(), mergedText).toBe(200);
    const mergedBody = JSON.parse(mergedText) as {
      merged: Array<{ ashedMemberId: string }>;
      failed: Array<{ ashedMemberId: string; code?: string }>;
    };
    expect(mergedBody.merged.map((item) => item.ashedMemberId)).toContain(
      fixture.linkedLastRankId,
    );
    expect(mergedBody.failed).toEqual([
      expect.objectContaining({
        ashedMemberId: fixture.realTwinFoldId,
        code: "ashed_connection_required",
      }),
    ]);
    expect(await memberStatus(sql, fixture.allianceId, fixture.linkedLastRankId)).toBe(
      "former",
    );
    expect(await memberStatus(sql, fixture.allianceId, fixture.linkedAshedId)).toBe(
      "active",
    );
    expect(await memberStatus(sql, fixture.allianceId, fixture.realTwinFoldId)).toBe(
      "active",
    );

    const [keptCommander] = await sql<
      {
        lastrank_public_id: number | null;
        profession: string | null;
        power_level: string | null;
        member_level: number | null;
        current_total_hero_power: number | null;
      }[]
    >`
      SELECT c.lastrank_public_id, c.profession, c.power_level, c.member_level,
             c.current_total_hero_power
      FROM commanders c
      INNER JOIN commander_alliance_memberships m ON m.commander_id = c.id
      WHERE m.alliance_id = ${fixture.allianceId}
        AND m.ashed_member_id = ${fixture.linkedAshedId}
        AND m.status = 'active'
    `;
    expect(keptCommander).toMatchObject({
      lastrank_public_id: 910_000,
      profession: "Engineer",
      power_level: "120.5M",
      member_level: 30,
      current_total_hero_power: 4_500_000,
    });

    const [link] = await sql<{ ashed_member_id: string }[]>`
      SELECT ashed_member_id FROM hq_member_links
      WHERE alliance_id = ${fixture.allianceId}
        AND hq_user_id = ${fixture.linkedHqUserId}
    `;
    expect(link?.ashed_member_id).toBe(fixture.linkedAshedId);

    const confirmed = await request.post(url, {
      headers,
      data: {
        action: "merge",
        confirmInexact: true,
        ashedMemberIds: [fixture.reviewDistanceLastRankId],
      },
    });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    expect(
      await memberStatus(sql, fixture.allianceId, fixture.reviewDistanceLastRankId),
    ).toBe("former");
    expect(
      await memberStatus(sql, fixture.allianceId, fixture.reviewDistanceAshedId),
    ).toBe("active");

    const removed = await request.post(url, {
      headers,
      data: { action: "remove", ashedMemberIds: [fixture.soloLastRankId] },
    });
    expect(removed.status(), await removed.text()).toBe(200);
    expect(await memberStatus(sql, fixture.allianceId, fixture.soloLastRankId)).toBe(
      "former",
    );

    const blockedRemove = await request.post(url, {
      headers,
      data: { action: "remove", ashedMemberIds: [fixture.onlyAshedId] },
    });
    const blockedText = await blockedRemove.text();
    expect(blockedRemove.status(), blockedText).toBe(200);
    expect(JSON.parse(blockedText)).toMatchObject({
      failed: [
        expect.objectContaining({
          ashedMemberId: fixture.onlyAshedId,
          code: "ashed_connection_required",
        }),
      ],
    });
    expect(await memberStatus(sql, fixture.allianceId, fixture.onlyAshedId)).toBe(
      "active",
    );
  });

  test("the roster screen merges exact Caos pairs and confirms near matches", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const fixture = await seedCaosRoster(sql);
    const maintainer = await createPlatformMaintainerSession(sql);
    await page.context().addCookies(playwrightAuthCookies(maintainer));

    await page.goto("/admin/roster-duplicates");
    await page.getByRole("textbox", { name: "Alliance", exact: true }).fill(fixture.tag);
    await page.getByRole("button", { name: "Choose an alliance" }).click();
    await page.getByRole("button", { name: new RegExp(fixture.tag) }).click();

    await expect(page.getByRole("heading", { name: "Same name" }).first()).toBeVisible();
    await expect(page.getByText("Names differ").first()).toBeVisible();
    await expect(page.getByText("LastRank imports with no name match")).toBeVisible();
    await expect(page.getByText("Only Ashed")).toHaveCount(0);
    await expect(page.getByTestId(`roster-check-${fixture.linkedLastRankId}`)).toBeChecked();
    await expect(page.getByTestId(`roster-check-${fixture.linkedAshedId}`)).not.toBeChecked();
    await expect(
      page.getByTestId(`roster-check-${fixture.reviewDistanceLastRankId}`),
    ).not.toBeChecked();

    await page.getByRole("button", { name: "Invert selection" }).click();
    await expect(page.getByTestId(`roster-check-${fixture.linkedAshedId}`)).toBeChecked();
    await page.getByRole("button", { name: "Invert selection" }).click();
    await expect(page.getByTestId(`roster-check-${fixture.linkedLastRankId}`)).toBeChecked();

    await page.getByRole("button", { name: "Merge selected" }).click();
    await expect(page.getByTestId("roster-duplicate-results")).toContainText(
      "This member still exists on Ashed",
    );
    // Both rows share the name. The LastRank copy leaves; the Ashed row stays.
    await expect(page.getByTestId(`roster-check-${fixture.linkedLastRankId}`)).toHaveCount(0);
    await expect(page.getByTestId(`roster-check-${fixture.linkedAshedId}`)).toBeVisible();
    await expect(page.getByText("Caos Exact 0", { exact: true })).toHaveCount(1);

    await page.getByTestId(`roster-check-${fixture.reviewDistanceLastRankId}`).check();
    await page.getByTestId(`roster-check-${fixture.reviewContainedLastRankId}`).check();
    await page.getByRole("button", { name: "Merge selected" }).click();
    const dialog = page.getByRole("dialog", { name: "These names do not match" });
    await expect(dialog).toContainText("Aleeaaaaa ← Aleeaaaa");
    await expect(dialog).toContainText("QMOX Gennysaur ← Gennysaur");
    await expect(dialog.getByRole("button", { name: "Merge these commanders" })).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: "I have checked that each pair is the same commander." })
      .check();
    await dialog.getByRole("button", { name: "Merge these commanders" }).click();
    await expect(page.getByText("Aleeaaaa", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Gennysaur", { exact: true })).toHaveCount(0);

    await page.getByTestId(`roster-check-${fixture.soloLastRankId}`).check();
    await page.getByRole("button", { name: "Remove selected" }).click();
    const removeDialog = page.getByRole("dialog", { name: "Remove selected members" });
    await expect(removeDialog).toContainText("Solo LastRank");
    await expect(removeDialog).toContainText("LastRank import");
    await removeDialog.getByRole("button", { name: "Remove members" }).click();
    await expect(page.getByText("Solo LastRank")).toHaveCount(0);

    const headers = { Cookie: authCookieHeader(maintainer) };
    const after = await request.get(
      `/api/admin/alliances/${fixture.allianceId}/roster-duplicates`,
      { headers },
    );
    expect(after.status(), await after.text()).toBe(200);
    expect(await memberStatus(sql, fixture.allianceId, fixture.linkedAshedId)).toBe(
      "active",
    );
    expect(await memberStatus(sql, fixture.allianceId, fixture.linkedLastRankId)).toBe(
      "former",
    );
  });
});
