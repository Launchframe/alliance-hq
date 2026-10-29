import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function insertAllianceMember(
  sql: ReturnType<typeof getE2eSql>,
  input: {
    allianceId: string;
    ashedMemberId: string;
    currentName: string;
    currentTotalHeroPower?: number;
    mainSquad?: string | null;
    gameUid?: string;
    profession?: string | null;
    professionLevel?: number | null;
  },
) {
  const now = new Date();
  await sql`
    INSERT INTO alliance_members (
      id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
      status, synced_at, created_at, updated_at,
      main_squad, game_uid
    ) VALUES (
      ${nanoid()},
      ${input.allianceId},
      ${input.ashedMemberId},
      ${input.allianceId},
      ${input.currentName},
      'active',
      ${now},
      ${now},
      ${now},
      ${input.mainSquad ?? null},
      ${input.gameUid ?? null}
    )
  `;

  if (input.currentTotalHeroPower != null) {
    const commanderId = nanoid(16);
    await sql`
      INSERT INTO commanders (
        id, primary_name, primary_name_normalized, current_alliance_id,
        current_total_hero_power, main_squad, profession, professional_level,
        created_at, updated_at
      ) VALUES (
        ${commanderId},
        ${input.currentName},
        ${input.currentName.toLowerCase()},
        ${input.allianceId},
        ${input.currentTotalHeroPower},
        ${input.mainSquad ?? null},
        ${input.profession ?? null},
        ${input.professionLevel ?? null},
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
  }
}

test.describe("Commanders index", () => {
  test("officer sees roster, team builder, and no leaked UIDs", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `CI${nanoid(3)}`,
      name: "Commanders Index Alliance",
    });

    const secretUid = "9988776655443322";
    // Unique ashed ids — hardcoded `ci-member-0` collides with prefetch/router
    // cache from other tests that reuse the same path.
    const memberIds = Array.from({ length: 10 }, () => `ci-${nanoid(10)}`);
    const warLeaderMemberId = memberIds[0]!;
    for (let i = 0; i < 10; i++) {
      await insertAllianceMember(sql, {
        allianceId: alliance.allianceId,
        ashedMemberId: memberIds[i]!,
        currentName: `CI Fighter ${i}`,
        currentTotalHeroPower: 5_000_000 - i * 100_000,
        mainSquad: i % 3 === 0 ? "aircraft" : i % 3 === 1 ? "tank" : "missile",
        gameUid: i === 0 ? secretUid : undefined,
        profession: i === 0 ? "War Leader" : null,
        professionLevel: i === 0 ? 37 : null,
      });
    }

    const session = await createAuthenticatedHqSession(sql, uniqueEmail("ci-officer"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
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
    // Profession headers are desktop-only (`hidden md:table-cell`). Force a
    // desktop viewport and clear saved column prefs so a prior worker visit
    // cannot hide them.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      window.localStorage.removeItem("alliance-hq-roster-columns-v2");
      window.localStorage.removeItem("alliance-hq-roster-columns-v1");
    });

    const apiRes = await request.get(`${e2eBaseUrl()}/api/commanders/index`, {
      headers: { Cookie: authCookieHeader(session) },
    });
    expect(apiRes.ok(), await apiRes.text()).toBeTruthy();
    const payload = (await apiRes.json()) as {
      rows: Array<{ memberName: string; totalHeroPower: number }>;
      canEdit: boolean;
    };
    expect(payload.canEdit).toBe(true);
    expect(payload.rows.length).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(payload)).not.toContain(secretUid);

    await page.goto("/members");
    await expect(page.getByRole("heading", { name: /^members$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "CI Fighter 0" })).toBeVisible();
    await expect(page.getByText(secretUid)).toHaveCount(0);

    // Prefer thead text over getByRole("columnheader"): Chromium can omit
    // these sortable <th> nodes from the columnheader role tree even when
    // they are display:table-cell. Assert the rendered header copy instead.
    await expect(page.locator("thead th", { hasText: /^Profession$/ })).toBeVisible();
    await expect(
      page.locator("thead th", { hasText: /^Profession level$/ }),
    ).toBeVisible();
    await expect(
      page.locator("thead th", { hasText: /^Previous names$/ }),
    ).toHaveCount(0);
    const warLeaderRow = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: "CI Fighter 0" }) });
    await expect(
      warLeaderRow.getByRole("cell", { name: "War Leader", exact: true }),
    ).toBeVisible();
    await expect(
      warLeaderRow.getByRole("cell", { name: "37", exact: true }),
    ).toBeVisible();

    const profileApi = await request.get(
      `${e2eBaseUrl()}/api/members/${warLeaderMemberId}`,
      { headers: { Cookie: authCookieHeader(session) } },
    );
    expect(profileApi.ok(), await profileApi.text()).toBeTruthy();
    const profilePayload = (await profileApi.json()) as {
      member: { profession: string | null; professionLevel: number | null };
    };
    expect(profilePayload.member.profession).toBe("War Leader");
    expect(profilePayload.member.professionLevel).toBe(37);

    // Prefer the roster link over a bare goto so we don't pick up a stale
    // soft-nav cache for a reused member id path.
    await page.getByRole("link", { name: "CI Fighter 0" }).click();
    await expect(page).toHaveURL(new RegExp(`/members/${warLeaderMemberId}`));
    await expect(page.locator("p", { hasText: "CI Fighter 0" }).first()).toBeVisible();
    const professionValue = page
      .locator("dt", { hasText: /^Profession$/ })
      .locator("xpath=following-sibling::dd[1]")
      .filter({ visible: true });
    const professionLevelValue = page
      .locator("dt", { hasText: /^Profession level$/ })
      .locator("xpath=following-sibling::dd[1]")
      .filter({ visible: true });
    await expect(professionValue).toHaveText("War Leader");
    await expect(professionLevelValue).toHaveText("37");

    await page.goto("/members");
    await expect(
      page.getByRole("heading", { name: /takedown team builder/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /build teams/i }).click();
    await expect(page.getByText(/team 1/i)).toBeVisible();
  });

  test("linked member self-reports main squad on profile", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `CS${nanoid(3)}`,
      name: "Commander Squad Self Report",
    });
    const memberId = `self-report-${nanoid(6)}`;
    await insertAllianceMember(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: memberId,
      currentName: "Self Report Commander",
      currentTotalHeroPower: 3_500_000,
    });

    const session = await createAuthenticatedHqSession(sql, uniqueEmail("ci-member"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
      ashedMemberId: memberId,
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
    await page.goto(`/members/${memberId}`);

    const squadSelect = page.locator("form select").first();
    await expect(squadSelect).toBeVisible();
    await squadSelect.selectOption("missile");
    await page.getByRole("button", { name: /save squad/i }).click();

    const patchRes = await request.post(
      `${e2eBaseUrl()}/api/members/${memberId}/main-squad`,
      {
        headers: {
          Cookie: authCookieHeader(session),
          "Content-Type": "application/json",
        },
        data: { mainSquad: "missile" },
      },
    );
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();

    await page.goto("/members");
    await expect(page.getByText("Missile").first()).toBeVisible();
  });
});
