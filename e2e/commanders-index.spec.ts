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
  },
) {
  const now = new Date();
  await sql`
    INSERT INTO alliance_members (
      id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
      status, synced_at, created_at, updated_at,
      current_total_hero_power, main_squad, game_uid
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
      ${input.currentTotalHeroPower ?? null},
      ${input.mainSquad ?? null},
      ${input.gameUid ?? null}
    )
  `;
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
    for (let i = 0; i < 10; i++) {
      await insertAllianceMember(sql, {
        allianceId: alliance.allianceId,
        ashedMemberId: `ci-member-${i}`,
        currentName: `CI Fighter ${i}`,
        currentTotalHeroPower: 5_000_000 - i * 100_000,
        mainSquad: i % 3 === 0 ? "aircraft" : i % 3 === 1 ? "tank" : "missile",
        gameUid: i === 0 ? secretUid : undefined,
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

    await page.context().addCookies(playwrightAuthCookies(session));

    const apiRes = await request.get(`${e2eBaseUrl()}/api/commanders/index`, {
      headers: authCookieHeader(session),
    });
    expect(apiRes.ok()).toBeTruthy();
    const payload = (await apiRes.json()) as {
      rows: Array<{ memberName: string; totalHeroPower: number }>;
      canEdit: boolean;
    };
    expect(payload.canEdit).toBe(true);
    expect(payload.rows.length).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(payload)).not.toContain(secretUid);

    await page.goto("/commanders");
    await expect(
      page.getByRole("heading", { name: /commanders index/i }),
    ).toBeVisible();
    await expect(page.getByText("CI Fighter 0")).toBeVisible();
    await expect(page.getByText(secretUid)).toHaveCount(0);

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
          ...authCookieHeader(session),
          "Content-Type": "application/json",
        },
        data: { mainSquad: "missile" },
      },
    );
    expect(patchRes.ok()).toBeTruthy();

    await page.goto("/commanders");
    await expect(page.getByText("Missile").first()).toBeVisible();
  });
});
