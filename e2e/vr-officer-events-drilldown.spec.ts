import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
  type Sql,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

async function insertCommanderWithVrEvent(
  sql: Sql,
  input: {
    allianceId: string;
    ashedMemberId: string;
    primaryName: string;
    seasonKey?: string;
    baseVr?: number;
    instituteLevel?: number;
  },
): Promise<{ commanderId: string; ashedMemberId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);
  const seasonKey = input.seasonKey ?? "1";
  const baseVr = input.baseVr ?? 100;
  const instituteLevel = input.instituteLevel ?? 1;

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.primaryName},
      ${input.primaryName.toLowerCase()},
      ${input.allianceId},
      ${now},
      ${now}
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
      ${now},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO commander_season_vr (
      id, commander_id, season_key, highest_base_vr, institute_level,
      created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${commanderId},
      ${seasonKey},
      ${baseVr},
      ${instituteLevel},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO commander_season_vr_events (
      id, commander_id, season_key, base_vr, institute_level, previous_base_vr,
      source, alliance_id, created_at
    ) VALUES (
      ${nanoid(16)},
      ${commanderId},
      ${seasonKey},
      ${baseVr},
      ${instituteLevel},
      ${null},
      ${"discord"},
      ${input.allianceId},
      ${now}
    )
  `;

  return { commanderId, ashedMemberId: input.ashedMemberId };
}

test.describe("VR officer events drilldown", () => {
  test("officer opens reports from leaderboard and navigates back", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `VR${nanoid(3)}`,
      name: "VR Drilldown Alliance",
    });

    const memberName = "Drilldown Fighter";
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: memberName,
    });
    await insertCommanderWithVrEvent(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      primaryName: memberName,
    });

    const session = await createAuthenticatedHqSession(
      sql,
      `vr-officer-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
      memberDisplayName: "VR Officer",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(session));

    const response = await page.goto("/viral-resistance");
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/viral-resistance/);
    await expect(
      page.getByRole("heading", { name: /^viral resistance$/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("cell", { name: memberName, exact: true }),
    ).toBeVisible();

    await page
      .getByTestId(`vr-officer-open-events-${ashedMemberId}`)
      .click();

    await expect(
      page.getByRole("heading", { name: `${memberName} VR reports` }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("cell", { name: "discord", exact: true })).toBeVisible();

    await page.getByTestId("vr-officer-events-back").click();
    await expect(
      page.getByRole("heading", { name: /^viral resistance$/i }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`vr-officer-open-events-${ashedMemberId}`),
    ).toBeVisible();
  });
});
