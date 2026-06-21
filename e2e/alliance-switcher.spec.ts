import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  attachAshedConnectionToSession,
  createAllianceMembership,
  createAshedAlliance,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
  sessionHasAshedCredential,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

test.describe("Alliance switcher — session context reset", () => {
  test("PATCH current-alliance clears Ashed credential and legacy session fields", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const allianceA = await createNativeAlliance(sql, {
      tag: `SWA${nanoid(3)}`,
      name: "Switcher Alliance A",
    });
    const allianceB = await createNativeAlliance(sql, {
      tag: `SWB${nanoid(3)}`,
      name: "Switcher Alliance B",
    });
    const session = await createAuthenticatedHqSession(sql, uniqueEmail("switcher"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: allianceA.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: allianceB.allianceId,
      roleName: "member",
      source: "manual",
    });

    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${allianceA.allianceId},
        alliance_tag = ${allianceA.tag},
        alliance_id = ${"stale-ashed-id"},
        user_label = ${"Stale Ashed User"}
      WHERE id = ${session.sessionId}
    `;
    await attachAshedConnectionToSession(sql, session.sessionId);

    const switchRes = await request.patch("/api/session/current-alliance", {
      headers: {
        Cookie: `alliance_hq_session=${session.sessionId}`,
      },
      data: { allianceId: allianceB.allianceId },
    });
    expect(switchRes.ok()).toBeTruthy();
    await expect(switchRes.json()).resolves.toMatchObject({
      ok: true,
      currentAllianceId: allianceB.allianceId,
      tag: allianceB.tag,
      operatingMode: "native",
      redirectPath: "/members",
    });

    expect(await sessionHasAshedCredential(sql, session.sessionId)).toBe(false);

    const [row] = await sql<
      {
        current_alliance_id: string | null;
        alliance_tag: string | null;
        alliance_id: string | null;
        user_label: string | null;
      }[]
    >`
      SELECT current_alliance_id, alliance_tag, alliance_id, user_label
      FROM sessions
      WHERE id = ${session.sessionId}
      LIMIT 1
    `;

    expect(row).toMatchObject({
      current_alliance_id: allianceB.allianceId,
      alliance_tag: allianceB.tag,
      alliance_id: null,
      user_label: null,
    });
  });

  test("sidebar picker is visible for multi-alliance members", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const allianceA = await createAshedAlliance(sql, {
      tag: `PCK${nanoid(3)}`,
      name: "Picker Alliance A",
    });
    const allianceB = await createNativeAlliance(sql, {
      tag: `PCK${nanoid(3)}`,
      name: "Picker Alliance B",
    });
    const session = await createAuthenticatedHqSession(sql, uniqueEmail("picker"));
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: allianceA.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: allianceB.allianceId,
      roleName: "member",
      source: "manual",
    });

    await sql`
      UPDATE sessions
      SET current_alliance_id = ${allianceA.allianceId}, alliance_tag = ${allianceA.tag}
      WHERE id = ${session.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto("/members");
    await expect(page.getByText("Alliance", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Alliance", exact: true }),
    ).toBeVisible();
  });
});
