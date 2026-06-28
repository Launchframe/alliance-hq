import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createDiscordHqLink,
  createHqDiscordOAuthAccount,
  createPlatformMaintainerSession,
  getE2eSql,
  loadDiscordHqLink,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Account Discord link / unlink", () => {
  test("syncs discord_hq_links from account OAuth complete page", async ({ page }) => {
    const sql = getE2eSql();
    const discordUserId = `discord-${nanoid(10)}`;
    const auth = await createPlatformMaintainerSession(sql);
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto("/discord/hq-link/complete?return=%2Faccount");

    await expect(page).toHaveURL(/\/account\?discordLinked=1/);
    const link = await loadDiscordHqLink(sql, discordUserId);
    expect(link?.hqUserId).toBe(auth.hqUserId);
  });

  test("unlinks Discord from account settings", async ({ page }) => {
    const sql = getE2eSql();
    const discordUserId = `discord-${nanoid(10)}`;
    const auth = await createPlatformMaintainerSession(sql);
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });
    await createDiscordHqLink(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto("/account");

    await expect(page.getByRole("button", { name: /unlink discord/i })).toBeVisible();
    await page.getByRole("button", { name: /unlink discord/i }).click();

    await expect(page.getByText(/discord bot unlinked/i)).toBeVisible();
    const link = await loadDiscordHqLink(sql, discordUserId);
    expect(link).toBeNull();
  });

  // NOTE: The `last_sign_in_method` guard (409) is tested at the unit level in
  // src/lib/auth/discord-hq-link.server.test.ts. An e2e trigger would require a
  // user whose email is non-empty (so loadSignInMethodSnapshot is non-null) yet
  // whose email.trim() is falsy — a brittle scenario that risks unique-constraint
  // collisions across parallel runs. Unit coverage is sufficient here.
});
