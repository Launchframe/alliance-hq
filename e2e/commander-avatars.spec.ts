import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

/** 1×1 PNG data URL — avoids external CDN onError → initials fallback. */
const AVATAR_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test.describe("Commander Last War avatars", () => {
  test("members table and profile render the stored game avatar", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `AV${nanoid(3)}`,
      name: "Avatar Alliance",
    });
    const memberId = `member-${nanoid(8)}`;
    const commanderName = "E2E Avatar Commander";
    const now = new Date();
    const commanderId = nanoid(16);

    await sql`
      INSERT INTO alliance_members (
        id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
        status, synced_at, created_at, updated_at
      ) VALUES (
        ${nanoid()},
        ${alliance.allianceId},
        ${memberId},
        ${alliance.allianceId},
        ${commanderName},
        'active',
        ${now},
        ${now},
        ${now}
      )
    `;
    await sql`
      INSERT INTO commanders (
        id, primary_name, primary_name_normalized, current_alliance_id,
        game_avatar_url, game_avatar_refreshed_at, created_at, updated_at
      ) VALUES (
        ${commanderId},
        ${commanderName},
        ${commanderName.toLowerCase()},
        ${alliance.allianceId},
        ${AVATAR_URL},
        ${now},
        ${now},
        ${now}
      )
    `;
    await sql`
      INSERT INTO commander_alliance_memberships (
        id, commander_id, alliance_id, ashed_member_id, status,
        joined_at, created_at, updated_at
      ) VALUES (
        ${nanoid()},
        ${commanderId},
        ${alliance.allianceId},
        ${memberId},
        'active',
        ${now},
        ${now},
        ${now}
      )
    `;

    const session = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("avatar-officer"),
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
      ashedMemberId: memberId,
      memberDisplayName: commanderName,
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

    await page.goto("/members");
    await expect(
      page.getByRole("link", { name: commanderName }),
    ).toBeVisible();
    await expect(page.locator(`img[src="${AVATAR_URL}"]`).first()).toBeVisible();

    await page.goto(`/members/${memberId}`);
    await expect(
      page.getByRole("heading", { name: commanderName }),
    ).toBeVisible();
    await expect(page.locator(`img[src="${AVATAR_URL}"]`).first()).toBeVisible();
  });

  test("members table shows initials when the commander has no avatar URL", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `AI${nanoid(3)}`,
      name: "Avatar Initials Alliance",
    });
    const memberId = `member-${nanoid(8)}`;
    const commanderName = "E2E Initials Only";
    const now = new Date();
    const commanderId = nanoid(16);

    await sql`
      INSERT INTO alliance_members (
        id, alliance_id, ashed_member_id, ashed_alliance_id, current_name,
        status, synced_at, created_at, updated_at
      ) VALUES (
        ${nanoid()},
        ${alliance.allianceId},
        ${memberId},
        ${alliance.allianceId},
        ${commanderName},
        'active',
        ${now},
        ${now},
        ${now}
      )
    `;
    await sql`
      INSERT INTO commanders (
        id, primary_name, primary_name_normalized, current_alliance_id,
        created_at, updated_at
      ) VALUES (
        ${commanderId},
        ${commanderName},
        ${commanderName.toLowerCase()},
        ${alliance.allianceId},
        ${now},
        ${now}
      )
    `;
    await sql`
      INSERT INTO commander_alliance_memberships (
        id, commander_id, alliance_id, ashed_member_id, status,
        joined_at, created_at, updated_at
      ) VALUES (
        ${nanoid()},
        ${commanderId},
        ${alliance.allianceId},
        ${memberId},
        'active',
        ${now},
        ${now},
        ${now}
      )
    `;

    const session = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("avatar-initials"),
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
      ashedMemberId: memberId,
      memberDisplayName: commanderName,
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
    await page.goto("/members");
    await expect(
      page.getByRole("link", { name: commanderName }),
    ).toBeVisible();
    // Initials from "E2E Initials Only" → first letters of the first two words.
    await expect(
      page
        .getByRole("cell", { name: commanderName })
        .locator("span[aria-hidden]")
        .filter({ hasText: "EI" }),
    ).toBeVisible();
    await expect(page.locator(`img[src="${AVATAR_URL}"]`)).toHaveCount(0);
  });
});
