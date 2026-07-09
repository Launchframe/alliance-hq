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
  type Sql,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function seedAllianceCommander(
  sql: Sql,
  input: {
    allianceId: string;
    ashedMemberId: string;
    primaryName: string;
    profession: "Engineer" | "War Leader";
  },
): Promise<{ commanderId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id,
      profession, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.primaryName},
      ${input.primaryName.toLowerCase()},
      ${input.allianceId},
      ${input.profession},
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

  return { commanderId };
}

async function seedProfessionCommander(
  sql: Sql,
  input: {
    allianceId: string;
    hqUserId: string;
    ashedMemberId: string;
    primaryName: string;
    profession: "Engineer" | "War Leader";
    isPrimary?: boolean;
  },
): Promise<{ commanderId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id,
      profession, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.primaryName},
      ${input.primaryName.toLowerCase()},
      ${input.allianceId},
      ${input.profession},
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
    INSERT INTO hq_user_commanders (
      id, hq_user_id, commander_id, is_primary, linked_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${input.hqUserId},
      ${commanderId},
      ${input.isPrimary ?? true},
      ${now},
      ${now}
    )
  `;

  return { commanderId };
}

async function bindSessionToAlliance(
  sql: Sql,
  sessionId: string,
  alliance: { allianceId: string; tag: string },
) {
  await sql`
    UPDATE sessions
    SET
      current_alliance_id = ${alliance.allianceId},
      alliance_id = ${alliance.allianceId},
      alliance_tag = ${alliance.tag}
    WHERE id = ${sessionId}
  `;
}

test.describe("Professions — War Leader Support", () => {
  test("Engineer assigns to War Leader via API and sees team on /professions", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `PR${nanoid(3)}`,
      name: "Professions Assign Alliance",
    });

    const wlMemberId = `wl-${nanoid(6)}`;
    const engMemberId = `eng-${nanoid(6)}`;

    const wlCommander = await seedAllianceCommander(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId: wlMemberId,
      primaryName: "E2E War Leader",
      profession: "War Leader",
    });

    const engSession = await createAuthenticatedHqSession(sql, uniqueEmail("prof-eng"));
    await createAllianceMembership(sql, {
      hqUserId: engSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: engSession.hqUserId,
      ashedMemberId: engMemberId,
      memberDisplayName: "E2E Engineer",
    });
    await seedProfessionCommander(sql, {
      allianceId: alliance.allianceId,
      hqUserId: engSession.hqUserId,
      ashedMemberId: engMemberId,
      primaryName: "E2E Engineer",
      profession: "Engineer",
    });
    await bindSessionToAlliance(sql, engSession.sessionId, alliance);

    const assignRes = await request.post(`${e2eBaseUrl()}/api/professions/assign`, {
      headers: {
        Cookie: authCookieHeader(engSession),
        "Content-Type": "application/json",
      },
      data: { wlCommanderId: wlCommander.commanderId },
    });
    expect(assignRes.ok(), await assignRes.text()).toBeTruthy();

    await page.context().addCookies(playwrightAuthCookies(engSession));
    await page.goto("/professions");
    await expect(page.getByRole("heading", { name: /^profession$/i })).toBeVisible();
    await expect(page.getByText("E2E War Leader")).toBeVisible();
  });

  test("officer loads officer portal tab", async ({ page, request }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `PO${nanoid(3)}`,
      name: "Professions Officer Alliance",
    });

    const officerSession = await createAuthenticatedHqSession(sql, uniqueEmail("prof-officer"));
    await createAllianceMembership(sql, {
      hqUserId: officerSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    const { ashedMemberId } = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: officerSession.hqUserId,
      memberDisplayName: "E2E Officer",
    });
    await seedProfessionCommander(sql, {
      allianceId: alliance.allianceId,
      hqUserId: officerSession.hqUserId,
      ashedMemberId,
      primaryName: "E2E Officer",
      profession: "War Leader",
    });
    await bindSessionToAlliance(sql, officerSession.sessionId, alliance);

    const portalRes = await request.get(`${e2eBaseUrl()}/api/professions/officer`, {
      headers: { Cookie: authCookieHeader(officerSession) },
    });
    expect(portalRes.ok(), await portalRes.text()).toBeTruthy();
    const payload = (await portalRes.json()) as { wlRows: unknown[] };
    expect(Array.isArray(payload.wlRows)).toBe(true);

    await page.context().addCookies(playwrightAuthCookies(officerSession));
    await page.goto("/professions");
    await expect(page.getByRole("heading", { name: /^profession$/i })).toBeVisible();
    await page.getByRole("button", { name: /^officer$/i }).click();
    await expect(
      page.getByText(/alliance-wide war leader coverage/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("member sets profession via switch API (onboarding path)", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `PS${nanoid(3)}`,
      name: "Professions Switch Alliance",
    });

    const memberSession = await createAuthenticatedHqSession(sql, uniqueEmail("prof-switch"));
    await createAllianceMembership(sql, {
      hqUserId: memberSession.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const { ashedMemberId } = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: memberSession.hqUserId,
      memberDisplayName: "E2E Switch Member",
    });
    const { commanderId } = await seedProfessionCommander(sql, {
      allianceId: alliance.allianceId,
      hqUserId: memberSession.hqUserId,
      ashedMemberId,
      primaryName: "E2E Switch Member",
      profession: "Engineer",
    });
    await bindSessionToAlliance(sql, memberSession.sessionId, alliance);

    await sql`
      UPDATE commanders SET profession = NULL WHERE id = ${commanderId}
    `;

    const switchRes = await request.post(`${e2eBaseUrl()}/api/professions/switch`, {
      headers: {
        Cookie: authCookieHeader(memberSession),
        "Content-Type": "application/json",
      },
      data: { toProfession: "War Leader" },
    });
    expect(switchRes.ok(), await switchRes.text()).toBeTruthy();

    const teamRes = await request.get(`${e2eBaseUrl()}/api/professions/my-team`, {
      headers: { Cookie: authCookieHeader(memberSession) },
    });
    expect(teamRes.ok(), await teamRes.text()).toBeTruthy();
    const team = (await teamRes.json()) as { profession: string };
    expect(team.profession).toBe("War Leader");
  });

  test("officer assign rejects cross-alliance commander id", async ({ request }) => {
    const sql = getE2eSql();
    const allianceA = await createNativeAlliance(sql, {
      tag: `PA${nanoid(3)}`,
      name: "Professions Alliance A",
    });
    const allianceB = await createNativeAlliance(sql, {
      tag: `PB${nanoid(3)}`,
      name: "Professions Alliance B",
    });

    const officerSession = await createAuthenticatedHqSession(sql, uniqueEmail("prof-xa-off"));
    await createAllianceMembership(sql, {
      hqUserId: officerSession.hqUserId,
      allianceId: allianceA.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: allianceA.allianceId,
      hqUserId: officerSession.hqUserId,
    });
    await bindSessionToAlliance(sql, officerSession.sessionId, allianceA);

    const foreignEng = await seedAllianceCommander(sql, {
      allianceId: allianceB.allianceId,
      ashedMemberId: `foreign-eng-${nanoid(4)}`,
      primaryName: "Foreign Engineer",
      profession: "Engineer",
    });
    const foreignWl = await seedAllianceCommander(sql, {
      allianceId: allianceB.allianceId,
      ashedMemberId: `foreign-wl-${nanoid(4)}`,
      primaryName: "Foreign WL",
      profession: "War Leader",
    });

    const assignRes = await request.post(
      `${e2eBaseUrl()}/api/professions/officer/assign`,
      {
        headers: {
          Cookie: authCookieHeader(officerSession),
          "Content-Type": "application/json",
        },
        data: {
          engCommanderId: foreignEng.commanderId,
          wlCommanderId: foreignWl.commanderId,
        },
      },
    );
    expect(assignRes.status()).toBe(400);
    const body = (await assignRes.json()) as { error: string };
    expect(body.error).toMatch(/not a member of this alliance/i);
  });
});
