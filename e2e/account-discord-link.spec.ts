import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  cleanupSeededActivityEvents,
  seedActivityEvent,
} from "./fixtures/activity";
import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createDiscordHqLink,
  createHqDiscordOAuthAccount,
  createHqMemberLink,
  createHqUserOnly,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  loadDiscordHqLink,
  playwrightAuthCookies,
} from "./fixtures/db";

test.afterEach(async () => {
  await cleanupSeededActivityEvents();
});

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

  test("claims only unowned discord events for the verified identity", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const discordUserId = `discord-${nanoid(10)}`;
    const otherDiscordId = `discord-${nanoid(10)}`;
    const auth = await createPlatformMaintainerSession(sql);
    const otherUser = await createHqUserOnly(
      sql,
      `other-${nanoid(6)}@alliance-hq.test`,
    );
    const second = await createAuthenticatedHqSession(
      sql,
      `relink-${nanoid(6)}@alliance-hq.test`,
    );
    const secondAlliance = await createNativeAlliance(sql, {
      tag: `RL${nanoid(3)}`,
      name: "Relink Alliance",
    });
    await createAllianceMembership(sql, {
      hqUserId: second.hqUserId,
      allianceId: secondAlliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: secondAlliance.allianceId,
      hqUserId: second.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${secondAlliance.allianceId}
      WHERE id = ${second.sessionId}
    `;

    const unowned1 = `e2e-act-${nanoid(8)}`;
    const unowned2 = `e2e-act-${nanoid(8)}`;
    const foreign = `e2e-act-${nanoid(8)}`;
    const preOwned = `e2e-act-${nanoid(8)}`;

    const seedDiscord = (id: string, overrides: Record<string, unknown>) =>
      seedActivityEvent({
        id,
        eventKey: "thp.submitted",
        feature: "thp",
        kind: "change",
        visibilityClass: "alliance",
        allianceId: `e2e-act-all-${nanoid(6)}`,
        actorKind: "discord",
        channel: "discord",
        actorDisplayName: "Discord Actor",
        payload: { value: "1" },
        ...overrides,
      });
    await seedDiscord(unowned1, { originalDiscordUserId: discordUserId });
    await seedDiscord(unowned2, { originalDiscordUserId: discordUserId });
    await seedDiscord(foreign, { originalDiscordUserId: otherDiscordId });
    await seedDiscord(preOwned, {
      originalDiscordUserId: discordUserId,
      personalOwnerHqUserId: otherUser.hqUserId,
    });

    const ownerOf = async (id: string) =>
      (
        await sql<{ owner: string | null }[]>`
          SELECT personal_owner_hq_user_id AS owner
          FROM activity_events WHERE id = ${id}
        `
      )[0]?.owner;

    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto("/discord/hq-link/complete?return=%2Faccount");
    await expect(page).toHaveURL(/\/account\?discordLinked=1/);

    expect(await ownerOf(unowned1)).toBe(auth.hqUserId);
    expect(await ownerOf(unowned2)).toBe(auth.hqUserId);
    expect(await ownerOf(foreign)).toBeNull();
    expect(await ownerOf(preOwned)).toBe(otherUser.hqUserId);

    await page.goto("/account");
    await page
      .getByRole("button", { name: /unlink discord/i })
      .click();
    await expect(
      page.getByText(/discord bot unlinked/i),
    ).toBeVisible();
    expect(await loadDiscordHqLink(sql, discordUserId)).toBeNull();
    expect(await ownerOf(unowned1)).toBe(auth.hqUserId);
    expect(await ownerOf(unowned2)).toBe(auth.hqUserId);

    const unowned3 = `e2e-act-${nanoid(8)}`;
    await seedDiscord(unowned3, { originalDiscordUserId: discordUserId });
    await sql`
      INSERT INTO hq_auth_accounts (
        id, hq_user_id, type, provider, provider_account_id, provider_email
      ) VALUES (
        ${nanoid(16)},
        ${second.hqUserId},
        ${"oauth"},
        ${"discord"},
        ${discordUserId},
        ${null}
      )
      ON CONFLICT (provider, provider_account_id) DO UPDATE
      SET hq_user_id = EXCLUDED.hq_user_id
    `;
    await page.context().addCookies(playwrightAuthCookies(second));
    await page.goto("/discord/hq-link/complete?return=%2Faccount");
    await expect(page).toHaveURL(/\/account\?discordLinked=1/);

    expect(await ownerOf(unowned3)).toBe(second.hqUserId);
    expect(await ownerOf(unowned1)).toBe(auth.hqUserId);
    expect(await ownerOf(unowned2)).toBe(auth.hqUserId);
    expect(await ownerOf(foreign)).toBeNull();
    expect(await ownerOf(preOwned)).toBe(otherUser.hqUserId);
  });

  // NOTE: The `last_sign_in_method` guard (409) is tested at the unit level in
  // src/lib/auth/discord-hq-link.server.test.ts. An e2e trigger would require a
  // user whose email is non-empty (so loadSignInMethodSnapshot is non-null) yet
  // whose email.trim() is falsy — a brittle scenario that risks unique-constraint
  // collisions across parallel runs. Unit coverage is sufficient here.
});
