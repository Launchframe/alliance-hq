import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceJoinCodeRow,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createDiscordUserLinkNonce,
  createHqDiscordOAuthAccount,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  loadDiscordHqLink,
  playwrightAuthCookies,
} from "./fixtures/db";
import { redeemJoinCodeInPage } from "./fixtures/join-code";

test.describe("Discord /link complete — inline join code", () => {
  test("redeems join code and completes commander onboarding from Discord link", async ({
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
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "E2eRosterMiss",
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
      page.getByText(/enter the join code shared by your alliance officers/i),
    ).toBeVisible();
    await expect(page.getByLabel(/join code/i)).toBeVisible();

    const link = await loadDiscordHqLink(sql, discordUserId);
    expect(link?.hqUserId).toBe(auth.hqUserId);

    await redeemJoinCodeInPage(page, code, {
      expectUrl: /\/onboard\?.*source=discord/,
    });
    await expect(page.getByText("Discord Link Join Alliance")).toBeVisible();
    await expect(page.getByRole("button", { name: /explore alliance hq/i })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/player uid/i).fill("1234567890121204");
    await page.getByRole("button", { name: /link my commander/i }).click();
    const confirm = page.getByRole("button", { name: /yes, that's me/i });
    await expect(confirm).toBeVisible();
    const linkResponse = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.endsWith("/api/member-link") &&
        res.request().method() === "POST",
    );
    await confirm.click();
    const response = await linkResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { outcome?: string; message?: string };
    expect(body.outcome, body.message ?? "no message").toBe("linked");

    await expect(page.getByRole("heading", { name: /you're linked/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /explore alliance hq/i })).toBeVisible();

    const [memberLink] = await sql<{ ashed_member_id: string }[]>`
      SELECT ashed_member_id
      FROM hq_member_links
      WHERE alliance_id = ${alliance.allianceId}
        AND hq_user_id = ${auth.hqUserId}
      LIMIT 1
    `;
    expect(memberLink?.ashed_member_id).toBe(ashedMemberId);
  });

  test("redirects to commander onboarding when user has membership but no commander link", async ({
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

    await expect(page).toHaveURL(/\/onboard\?.*source=discord/);
    await expect(page.getByText("Discord Link Member Alliance")).toBeVisible();
  });

  test("shows explore success when membership and commander are already linked", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DX${nanoid(3)}`,
      name: "Discord Link Ready Alliance",
    });

    const discordUserId = `discord-${nanoid(10)}`;
    const auth = await createAuthenticatedHqSession(
      sql,
      `discord-ready-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
      memberDisplayName: "E2E Ready Commander",
    });
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });
    const nonce = await createDiscordUserLinkNonce(sql, { discordUserId });

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`);

    await expect(page.getByText("Connected!")).toBeVisible();
    await expect(page.getByRole("link", { name: /explore alliance hq/i })).toBeVisible();
    await expect(page.getByLabel(/join code/i)).toHaveCount(0);
  });

  test("shows inline error and stays on page when join code is invalid", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const discordUserId = `discord-${nanoid(10)}`;
    const auth = await createAuthenticatedHqSession(
      sql,
      `discord-badcode-${nanoid(6)}@e2e.test`,
    );
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: auth.hqUserId,
      discordUserId,
    });
    const nonce = await createDiscordUserLinkNonce(sql, { discordUserId });

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/discord/authorize/complete?nonce=${encodeURIComponent(nonce)}`);

    await expect(page.getByLabel(/join code/i)).toBeVisible();

    const input = page.getByLabel(/join code/i);
    await input.fill("BADCODE99");
    await expect(input).toHaveValue("BADCODE99");

    const redeemResponse = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.endsWith("/api/join-codes/redeem") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /join alliance/i }).click();
    const response = await redeemResponse;
    expect(response.ok()).toBe(false);

    // Error displayed (API returns "Join code not found."); user stays on the
    // join-code page and is not redirected to /onboard.
    await expect(page.getByText(/join code not found/i)).toBeVisible();
    await expect(page).not.toHaveURL(/\/onboard/);
  });
});
