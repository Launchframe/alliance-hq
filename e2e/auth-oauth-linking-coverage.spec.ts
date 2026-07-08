import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type Page } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqDiscordOAuthAccount,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
  seedOAuthIdentitySplitScenario,
} from "./fixtures/db";

async function bootstrapSettingsPageSession(
  sql: ReturnType<typeof getE2eSql>,
  session: Awaited<ReturnType<typeof createAuthenticatedHqSession>>,
) {
  const alliance = await createNativeAlliance(sql, {
    tag: `OA${nanoid(3)}`,
    name: "OAuth Linking Alliance",
  });
  await createAllianceMembership(sql, {
    hqUserId: session.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "member",
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: session.hqUserId,
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId}
    WHERE id = ${session.sessionId}
  `;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

function e2eOAuthCompletePath(
  provider: "discord" | "google",
  providerAccountId: string,
  providerEmail?: string,
): string {
  const params = new URLSearchParams({
    provider,
    providerAccountId,
  });
  if (providerEmail) {
    params.set("providerEmail", providerEmail);
  }
  return `/api/internal/e2e/oauth-link/complete?${params}`;
}

async function stubOAuthProviderSignIn(
  page: Page,
  provider: "discord" | "google",
  providerAccountId: string,
  providerEmail?: string,
) {
  await page.route(`**/api/auth/signin/${provider}**`, async (route) => {
    await route.fulfill({
      status: 302,
      headers: {
        Location: e2eOAuthCompletePath(provider, providerAccountId, providerEmail),
      },
    });
  });
}

test.describe("OAuth linking — error surfaces", () => {
  test("settings page surfaces OAuthProviderTypeAlreadyLinked link errors", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `type-linked-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto("/settings/account?linkError=OAuthProviderTypeAlreadyLinked");

    const signInMethods = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Sign-in methods/i }),
    });
    await expect(
      signInMethods.getByText(/already has Google or Discord linked/i),
    ).toBeVisible();
  });

  test("signed-in link API returns provider_type_already_linked for a second Discord account", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `api-type-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    const firstDiscordId = `discord-${nanoid(10)}`;
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: session.hqUserId,
      discordUserId: firstDiscordId,
      providerEmail: `first-${nanoid(4)}@discord.test`,
    });

    const linkRes = await page.request.post("/api/internal/e2e/oauth-link", {
      headers: { Cookie: authCookieHeader(session) },
      data: {
        action: "signed_in_link",
        provider: "discord",
        providerAccountId: `discord-${nanoid(10)}`,
        providerEmail: `second-${nanoid(4)}@discord.test`,
      },
    });
    expect(linkRes.status()).toBe(409);
    const body = (await linkRes.json()) as { ok?: boolean; code?: string };
    expect(body).toMatchObject({ ok: false, code: "provider_type_already_linked" });
  });
});

test.describe("OAuth linking — Google path", () => {
  test("signed-in Google link stores provider email and shows it on settings", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const hqEmail = `google-hq-${nanoid(6)}@alliance-hq.test`;
    const providerEmail = `google-${nanoid(6)}@google.test`;
    const googleAccountId = `google-${nanoid(12)}`;
    const session = await createAuthenticatedHqSession(sql, hqEmail);
    await bootstrapSettingsPageSession(sql, session);
    await page.context().addCookies(playwrightAuthCookies(session));

    const linkRes = await page.request.post("/api/internal/e2e/oauth-link", {
      headers: { Cookie: authCookieHeader(session) },
      data: {
        action: "signed_in_link",
        provider: "google",
        providerAccountId: googleAccountId,
        providerEmail,
      },
    });
    expect(linkRes.ok(), await linkRes.text()).toBeTruthy();

    const accountsRes = await page.request.get("/api/auth/linked-accounts", {
      headers: { Cookie: authCookieHeader(session) },
    });
    expect(accountsRes.ok()).toBeTruthy();
    const accountsBody = (await accountsRes.json()) as {
      oauthAccounts?: Array<{ provider: string; providerEmail: string | null }>;
    };
    expect(accountsBody.oauthAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "google",
          providerEmail: providerEmail.toLowerCase(),
        }),
      ]),
    );

    await page.goto("/settings/account");
    const signInMethods = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Sign-in methods/i }),
    });
    await expect(
      signInMethods.getByText(providerEmail.toLowerCase(), { exact: false }),
    ).toBeVisible();
  });
});

test.describe("OAuth linking — browser shim round-trip", () => {
  test("Link Discord button completes through the e2e OAuth callback shim", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `browser-discord-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    await page.context().addCookies(playwrightAuthCookies(session));

    const discordUserId = `discord-${nanoid(10)}`;
    const providerEmail = `browser-${nanoid(4)}@discord.test`;
    await stubOAuthProviderSignIn(page, "discord", discordUserId, providerEmail);

    await page.goto("/settings/account");
    await page
      .getByRole("button", { name: /link discord/i })
      .click();

    await expect(page).toHaveURL(/\/settings\/account\?linked=discord/);
    const signInMethods = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Sign-in methods/i }),
    });
    await expect(
      signInMethods.getByText(providerEmail.toLowerCase(), { exact: false }),
    ).toBeVisible();
  });

  test("Link Google button completes through the e2e OAuth callback shim", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `browser-google-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    await page.context().addCookies(playwrightAuthCookies(session));

    const googleAccountId = `google-${nanoid(12)}`;
    const providerEmail = `browser-${nanoid(4)}@google.test`;
    await stubOAuthProviderSignIn(page, "google", googleAccountId, providerEmail);

    await page.goto("/settings/account");
    await page.getByRole("button", { name: /link google/i }).click();

    await expect(page).toHaveURL(/\/settings\/account\?linked=google/);
    const signInMethods = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Sign-in methods/i }),
    });
    await expect(
      signInMethods.getByText(providerEmail.toLowerCase(), { exact: false }),
    ).toBeVisible();
  });

  test("e2e OAuth complete shim rejects a second Discord account in the browser", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `browser-type-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: session.hqUserId,
      discordUserId: `discord-${nanoid(10)}`,
      providerEmail: `existing-${nanoid(4)}@discord.test`,
    });
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto(
      e2eOAuthCompletePath(
        "discord",
        `discord-${nanoid(10)}`,
        `other-${nanoid(4)}@discord.test`,
      ),
    );

    await expect(page).toHaveURL(/linkError=OAuthProviderTypeAlreadyLinked/);
    const signInMethods = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Sign-in methods/i }),
    });
    await expect(
      signInMethods.getByText(/already has Google or Discord linked/i),
    ).toBeVisible();
  });
});

test.describe("OAuth identity split badge", () => {
  test("officer roster shows Discord split badge when OAuth owner differs from commander link", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `SP${nanoid(3)}`,
      name: "OAuth Split Alliance",
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("split-officer"));
    const commander = await createAuthenticatedHqSession(sql, uniqueEmail("split-commander"));
    const oauthUser = await createAuthenticatedHqSession(sql, uniqueEmail("split-oauth"));
    const discordUserId = `9${String(Date.now()).slice(-16)}`;

    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: officer.hqUserId,
      memberDisplayName: "Officer Self",
    });
    const { commanderName } = await seedOAuthIdentitySplitScenario(sql, {
      allianceId: alliance.allianceId,
      commanderHqUserId: commander.hqUserId,
      oauthHqUserId: oauthUser.hqUserId,
      discordUserId,
      commanderName: "Split Badge Commander",
      oauthHqEmail: oauthUser.email,
    });

    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    await page.context().addCookies(playwrightAuthCookies(officer));
    await page.goto("/members");
    await expect(page.getByText(commanderName)).toBeVisible();
    const row = page.locator("tr").filter({ hasText: commanderName });
    await expect(row.getByText("Discord split", { exact: true })).toBeVisible();
  });

  test("platform maintainer sees Discord split badge in HQ Users admin", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const commander = await createAuthenticatedHqSession(
      sql,
      `split-admin-${nanoid(6)}@e2e.test`,
    );
    const oauthUser = await createAuthenticatedHqSession(sql, uniqueEmail("split-oauth-admin"));
    const alliance = await createNativeAlliance(sql, {
      tag: `SA${nanoid(3)}`,
      name: "Split Admin Alliance",
    });
    const discordUserId = `9${String(Date.now()).slice(-16)}1`;

    await seedOAuthIdentitySplitScenario(sql, {
      allianceId: alliance.allianceId,
      commanderHqUserId: commander.hqUserId,
      oauthHqUserId: oauthUser.hqUserId,
      discordUserId,
      oauthHqEmail: oauthUser.email,
    });

    await page.context().addCookies(playwrightAuthCookies(maintainer));
    await page.goto("/admin/users");
    await page.getByPlaceholder(/email, name, user id/i).fill(commander.email);
    await expect(page.getByText(commander.email)).toBeVisible();
    await expect(page.getByText("Discord split", { exact: true }).first()).toBeVisible();

    await page.getByText(commander.email).click();
    await expect(
      page.getByText(/discord sign-in is linked to a different hq account/i),
    ).toBeVisible();
  });
});
