import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceJoinCodeRow,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createDiscordUserLinkNonce,
  createHqDiscordOAuthAccount,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  loadDiscordHqLink,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Discord /link complete — inline join code", () => {
  test("shows join code form when HQ is linked but user has no alliance membership", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `DL${nanoid(3)}`,
      name: "Discord Link Join Alliance",
    });
    const { code } = await createAllianceJoinCodeRow(sql, {
      allianceId: alliance.allianceId,
      roleName: "member",
      createdByHqUserId: maintainer.hqUserId,
    });

    const discordUserId = `discord-${nanoid(10)}`;
    const auth = await createAuthenticatedHqSession(
      sql,
      `discord-link-${nanoid(6)}@e2e.test`,
    );
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });
    const nonce = await createDiscordUserLinkNonce(sql, { discordUserId });

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`);

    await expect(page.getByText("Connected!")).toBeVisible();
    await expect(
      page.getByText(/your discord account is linked to alliance hq/i),
    ).toBeVisible();
    await expect(
      page.getByText(/enter the join code shared by your alliance officers/i),
    ).toBeVisible();
    await expect(page.getByLabel(/join code/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /back to get started/i })).toHaveCount(
      0,
    );

    const link = await loadDiscordHqLink(sql, discordUserId);
    expect(link?.hqUserId).toBe(auth.hqUserId);

    await page.getByLabel(/join code/i).fill(code);
    await page.getByRole("button", { name: /join alliance/i }).click();

    await expect(page).toHaveURL(/\/onboard/);
    await expect(page.getByText("Discord Link Join Alliance")).toBeVisible();
  });

  test("shows static success when user already has an alliance membership", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DM${nanoid(3)}`,
      name: "Discord Link Member Alliance",
    });

    const discordUserId = `discord-${nanoid(10)}`;
    const auth = await createAuthenticatedHqSession(
      sql,
      `discord-member-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });
    const nonce = await createDiscordUserLinkNonce(sql, { discordUserId });

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`);

    await expect(page.getByText("Connected!")).toBeVisible();
    await expect(page.getByText(/return to discord and run/i)).toBeVisible();
    await expect(page.getByLabel(/join code/i)).toHaveCount(0);
  });
});
