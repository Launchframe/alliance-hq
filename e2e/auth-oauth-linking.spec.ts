import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqDiscordOAuthAccount,
  createHqMemberLink,
  createHqUserOnly,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
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

test.describe("Auth OAuth account linking errors", () => {
  test("OAuthAccountNotLinked error page shows updated guidance", async ({
    page,
  }) => {
    await page.goto("/auth/error?error=OAuthAccountNotLinked");

    await expect(
      page.getByRole("heading", {
        name: /This Google or Discord account is not linked/i,
      }),
    ).toBeVisible();

    await expect(
      page.getByText(/Sign in with your HQ email first/i),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Back to sign in/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Open sign-in & security settings/i }),
    ).toHaveAttribute("href", /\/settings\/account/);
  });

  test("auth sign-in page surfaces the same OAuthAccountNotLinked copy", async ({
    page,
  }) => {
    await page.goto("/auth?error=OAuthAccountNotLinked");

    await expect(
      page.getByText(/Sign in with your HQ email first/i),
    ).toBeVisible();
  });

  test("OAuthSignInRequired error page shows provider-specific guidance", async ({
    page,
  }) => {
    await page.goto(
      "/auth/error?error=OAuthSignInRequired&email=player%40example.com&providers=google",
    );

    await expect(
      page.getByRole("heading", { name: /Use Google or Discord to sign in/i }),
    ).toBeVisible();

    await expect(
      page.getByText(/Please sign in with Google using player@example.com/i),
    ).toBeVisible();

    await expect(
      page.getByText(/Email verification codes and magic links cannot be used/i),
    ).toBeVisible();
  });

  test("auth sign-in page surfaces OAuthSignInRequired guidance", async ({
    page,
  }) => {
    await page.goto(
      "/auth?error=OAuthSignInRequired&email=player%40example.com&providers=google",
    );

    await expect(
      page.getByText(/Please sign in with Google using player@example.com/i),
    ).toBeVisible();
  });

  test("settings page surfaces OAuthAccountAlreadyLinked link errors", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `linkerr-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto("/settings/account?linkError=OAuthAccountAlreadyLinked");

    const signInMethods = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Sign-in methods/i }),
    });
    await expect(
      signInMethods.getByText(/already linked to a different Alliance HQ account/i),
    ).toBeVisible();
  });
});

test.describe("Auth OAuth provider-ID linking", () => {
  test("signed-in link succeeds when provider email differs from HQ email", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const hqEmail = `hq-${nanoid(6)}@alliance-hq.test`;
    const providerEmail = `discord-${nanoid(6)}@discord.test`;
    const discordUserId = `discord-${nanoid(10)}`;
    const session = await createAuthenticatedHqSession(sql, hqEmail);
    await bootstrapSettingsPageSession(sql, session);

    await page.context().addCookies(playwrightAuthCookies(session));

    const linkRes = await page.request.post("/api/internal/e2e/oauth-link", {
      headers: { Cookie: authCookieHeader(session) },
      data: {
        action: "signed_in_link",
        provider: "discord",
        providerAccountId: discordUserId,
        providerEmail,
      },
    });
    expect(linkRes.ok(), await linkRes.text()).toBeTruthy();
    const linkBody = (await linkRes.json()) as { ok?: boolean; action?: string };
    expect(linkBody).toMatchObject({ ok: true, action: "linked" });

    const [userRow] = await sql<{ email: string }[]>`
      SELECT email FROM hq_users WHERE id = ${session.hqUserId}
    `;
    expect(userRow?.email).toBe(hqEmail.toLowerCase());

    const [accountRow] = await sql<{ provider_email: string | null }[]>`
      SELECT provider_email
      FROM hq_auth_accounts
      WHERE hq_user_id = ${session.hqUserId}
        AND provider = 'discord'
      LIMIT 1
    `;
    expect(accountRow?.provider_email).toBe(providerEmail.toLowerCase());

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
          provider: "discord",
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

  test("cold sign-in resolves an already-linked provider account by ID", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const hqEmail = `cold-${nanoid(6)}@alliance-hq.test`;
    const discordUserId = `discord-${nanoid(10)}`;
    const user = await createHqUserOnly(sql, hqEmail);
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: user.hqUserId,
      discordUserId,
      providerEmail: `provider-${nanoid(6)}@discord.test`,
    });

    const resolveRes = await page.request.post("/api/internal/e2e/oauth-link", {
      data: {
        action: "resolve_owner",
        provider: "discord",
        providerAccountId: discordUserId,
      },
    });
    expect(resolveRes.ok()).toBeTruthy();
    const body = (await resolveRes.json()) as { hqUserId?: string };
    expect(body.hqUserId).toBe(user.hqUserId);
  });
});
