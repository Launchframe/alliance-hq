import { randomBytes } from "node:crypto";

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
  playwrightAuthCookies,
  type SessionFixture,
} from "./fixtures/db";

type Sql = ReturnType<typeof getE2eSql>;

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function seedRosterCommander(
  sql: Sql,
  input: { allianceId: string; name: string },
): Promise<{ ashedMemberId: string; commanderId: string }> {
  const now = new Date();
  const { ashedMemberId } = await createAllianceRosterMember(sql, {
    allianceId: input.allianceId,
    currentName: input.name,
  });
  const commanderId = nanoid(16);
  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId}, ${input.name}, ${input.name.toLowerCase()}, ${input.allianceId}, ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)}, ${commanderId}, ${input.allianceId}, ${ashedMemberId}, 'active', ${now}, ${now}, ${now}
    )
  `;
  return { ashedMemberId, commanderId };
}

async function signInToAlliance(
  sql: Sql,
  input: {
    allianceId: string;
    allianceTag: string;
    roleName: "officer" | "member";
    prefix: string;
  },
): Promise<SessionFixture> {
  const session = await createAuthenticatedHqSession(sql, uniqueEmail(input.prefix));
  await createAllianceMembership(sql, {
    hqUserId: session.hqUserId,
    allianceId: input.allianceId,
    roleName: input.roleName,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: input.allianceId,
    hqUserId: session.hqUserId,
  });
  await sql`
    UPDATE sessions
    SET
      current_alliance_id = ${input.allianceId},
      alliance_id = ${input.allianceId},
      alliance_tag = ${input.allianceTag}
    WHERE id = ${session.sessionId}
  `;
  return session;
}

test.describe("Merge duplicate commander", () => {
  test("officer merges a renamed duplicate into the existing commander", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MD${nanoid(3)}`,
      name: "Merge Duplicate Alliance",
    });
    const keptName = `E2E Keeper ${nanoid(4)}`;
    const duplicateName = `E2E Renamed ${nanoid(4)}`;
    const kept = await seedRosterCommander(sql, {
      allianceId: alliance.allianceId,
      name: keptName,
    });
    const duplicate = await seedRosterCommander(sql, {
      allianceId: alliance.allianceId,
      name: duplicateName,
    });
    const levelEventId = nanoid(16);
    await sql`
      INSERT INTO commander_level_events (id, commander_id, total, source, alliance_id, created_at)
      VALUES (${levelEventId}, ${duplicate.commanderId}, 30, 'e2e', ${alliance.allianceId}, ${new Date()})
    `;

    const officer = await signInToAlliance(sql, {
      allianceId: alliance.allianceId,
      allianceTag: alliance.tag,
      roleName: "officer",
      prefix: "merge-officer",
    });
    await page.context().addCookies(playwrightAuthCookies(officer));

    await page.goto(`/members/${kept.ashedMemberId}`);
    await expect(page.getByRole("heading", { name: keptName })).toBeVisible();
    await page.getByTestId("merge-duplicate-open").first().click();
    await page.getByTestId("merge-duplicate-search").fill("Renamed");
    await page
      .getByTestId("merge-duplicate-candidate")
      .filter({ hasText: duplicateName })
      .click();
    const preview = page.getByTestId("merge-duplicate-preview");
    await expect(preview).toContainText(duplicateName);
    await expect(preview).toContainText(keptName);
    await page.getByTestId("merge-duplicate-confirm").click();

    await expect(page.getByRole("heading", { name: duplicateName })).toBeVisible({
      timeout: 15_000,
    });

    const [keptRoster] = await sql<
      { current_name: string; previous_names_json: unknown; status: string }[]
    >`
      SELECT current_name, previous_names_json, status FROM alliance_members
      WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${kept.ashedMemberId}
    `;
    expect(keptRoster?.current_name).toBe(duplicateName);
    expect(keptRoster?.status).toBe("active");
    expect(JSON.stringify(keptRoster?.previous_names_json)).toContain(keptName);

    const [duplicateRoster] = await sql<{ status: string }[]>`
      SELECT status FROM alliance_members
      WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${duplicate.ashedMemberId}
    `;
    expect(duplicateRoster?.status).toBe("former");

    const [levelEvent] = await sql<{ commander_id: string }[]>`
      SELECT commander_id FROM commander_level_events WHERE id = ${levelEventId}
    `;
    expect(levelEvent?.commander_id).toBe(kept.commanderId);

    const [audit] = await sql<{ id: string }[]>`
      SELECT id FROM audit_log
      WHERE alliance_id = ${alliance.allianceId} AND action = 'member_duplicate_merged'
      LIMIT 1
    `;
    expect(audit).toBeDefined();
  });

  test("member without members:write gets 403 and no merge control", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MN${nanoid(3)}`,
      name: "Merge Denied Alliance",
    });
    const kept = await seedRosterCommander(sql, {
      allianceId: alliance.allianceId,
      name: `E2E Member Keep ${nanoid(4)}`,
    });
    const duplicate = await seedRosterCommander(sql, {
      allianceId: alliance.allianceId,
      name: `E2E Member Dup ${nanoid(4)}`,
    });
    const member = await signInToAlliance(sql, {
      allianceId: alliance.allianceId,
      allianceTag: alliance.tag,
      roleName: "member",
      prefix: "merge-member",
    });
    await page.context().addCookies(playwrightAuthCookies(member));

    await page.goto(`/members/${kept.ashedMemberId}`);
    await expect(page.getByTestId("merge-duplicate-open")).toHaveCount(0);

    const res = await request.post(
      `${e2eBaseUrl()}/api/members/${kept.ashedMemberId}/merge-duplicate`,
      {
        headers: { Cookie: authCookieHeader(member) },
        data: { duplicateAshedMemberId: duplicate.ashedMemberId },
      },
    );
    expect(res.status()).toBe(403);

    const [duplicateRoster] = await sql<{ status: string }[]>`
      SELECT status FROM alliance_members
      WHERE alliance_id = ${alliance.allianceId} AND ashed_member_id = ${duplicate.ashedMemberId}
    `;
    expect(duplicateRoster?.status).toBe("active");
  });

  test("officer cannot merge members of another alliance", async ({ request }) => {
    const sql = getE2eSql();
    const allianceA = await createNativeAlliance(sql, {
      tag: `MA${nanoid(3)}`,
      name: "Merge Alliance A",
    });
    const allianceB = await createNativeAlliance(sql, {
      tag: `MB${nanoid(3)}`,
      name: "Merge Alliance B",
    });
    const foreignKept = await seedRosterCommander(sql, {
      allianceId: allianceB.allianceId,
      name: `E2E Foreign Keep ${nanoid(4)}`,
    });
    const foreignDuplicate = await seedRosterCommander(sql, {
      allianceId: allianceB.allianceId,
      name: `E2E Foreign Dup ${nanoid(4)}`,
    });
    const officer = await signInToAlliance(sql, {
      allianceId: allianceA.allianceId,
      allianceTag: allianceA.tag,
      roleName: "officer",
      prefix: "merge-foreign",
    });

    const res = await request.post(
      `${e2eBaseUrl()}/api/members/${foreignKept.ashedMemberId}/merge-duplicate`,
      {
        headers: { Cookie: authCookieHeader(officer) },
        data: { duplicateAshedMemberId: foreignDuplicate.ashedMemberId },
      },
    );
    expect(res.status()).toBe(404);

    const [foreignRoster] = await sql<{ status: string }[]>`
      SELECT status FROM alliance_members
      WHERE alliance_id = ${allianceB.allianceId}
        AND ashed_member_id = ${foreignDuplicate.ashedMemberId}
    `;
    expect(foreignRoster?.status).toBe("active");
  });
});
