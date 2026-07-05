import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

test.describe("Alliance Discord server setup panel", () => {
  test("officer with trains:write sees manage controls", async ({ page }) => {
    const sql = getE2eSql();
    const tag = `DS${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Discord Setup Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("discord-setup-officer"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/discord");

    await expect(
      page.getByRole("heading", { name: /Discord bot — add another server/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/No Discord servers are registered for this alliance yet/i),
    ).toBeVisible();
    await expect(page.getByText(/After adding the bot/i)).toBeVisible();

    const installLink = page.getByRole("link", {
      name: /Add bot to a Discord server/i,
    });
    const installUnavailable = page.getByText(
      /Bot install is not configured on this deployment/i,
    );
    await expect(installLink.or(installUnavailable)).toBeVisible();
  });

  test("viewer without trains:write sees read-only hint", async ({ page }) => {
    const sql = getE2eSql();
    const tag = `DS${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Discord Setup Viewer Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("discord-setup-viewer"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "viewer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/discord");

    await expect(
      page.getByRole("heading", { name: /Discord bot — add another server/i }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Only alliance owners, train officers, and platform maintainers can add or register Discord servers/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Add bot to a Discord server/i }),
    ).toHaveCount(0);
  });

  test("platform maintainer picks alliance then can install Discord bot", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const tag = `DS${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "Discord Setup Maintainer Alliance",
    });
    const auth = await createPlatformMaintainerSession(sql);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/discord");

    await expect(
      page.getByRole("heading", { name: /choose an alliance/i }),
    ).toBeVisible();

    const switchRes = await request.patch("/api/session/current-alliance", {
      headers: { Cookie: `alliance_hq_session=${auth.sessionId}` },
      data: { allianceId: alliance.allianceId },
    });
    expect(switchRes.ok(), await switchRes.text()).toBeTruthy();

    await page.reload();

    await expect(
      page.getByRole("heading", { name: /Discord bot — add another server/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/server they own or can manage/i),
    ).toBeVisible();
    await expect(
      page.getByText(/R5 owner, R4\+ officer with a linked commander, or platform maintainer/i),
    ).toBeVisible();

    const installLink = page.getByRole("link", {
      name: /Add bot to a Discord server/i,
    });
    const installUnavailable = page.getByText(
      /Bot install is not configured on this deployment/i,
    );
    await expect(installLink.or(installUnavailable)).toBeVisible();
  });
});
