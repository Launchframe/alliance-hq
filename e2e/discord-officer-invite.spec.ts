import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqDiscordOAuthAccount,
  createNativeAlliance,
  getE2eSql,
  loadDiscordHqLink,
  loadMembershipRoleName,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

function extractInviteToken(inviteUrl: string): string {
  const match = inviteUrl.match(/\/invite\/([^/?#]+)/);
  if (!match?.[1]) {
    throw new Error(`Could not parse invite token from URL: ${inviteUrl}`);
  }
  return decodeURIComponent(match[1]);
}

function e2eDiscordUserId(): string {
  const suffix = String(randomBytes(2).readUInt16BE(0) % 100000).padStart(5, "0");
  return `1234567890123${suffix}`;
}

test.describe("Discord officer invites", () => {
  test("owner creates invite; matching Discord account accepts with passphrase", async ({
    request,
    baseURL,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DO${nanoid(3)}`,
      name: `Discord Officer ${nanoid(4)}`,
    });
    const owner = await createAuthenticatedHqSession(sql, uniqueEmail("owner"));
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;

    const discordUserId = e2eDiscordUserId();
    const createRes = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(owner) },
      data: {
        kind: "discord_officer",
        roleName: "officer",
        targetDiscordUserId: discordUserId,
        adminLabel: "R4 trains",
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as {
      invite?: { inviteUrl: string; passphrase?: string; roleName?: string };
    };
    expect(created.invite?.roleName).toBe("officer");
    expect(created.invite?.passphrase).toBeTruthy();
    const token = extractInviteToken(created.invite!.inviteUrl);
    const passphrase = created.invite!.passphrase!;

    const officerEmail = uniqueEmail("discord-officer");
    const officer = await createAuthenticatedHqSession(sql, officerEmail);
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: officer.hqUserId,
      discordUserId,
    });

    const accepted = await acceptInviteViaApi(
      sql,
      baseURL!,
      token,
      officerEmail,
      undefined,
      officer.sessionId,
      passphrase,
    );
    expect(accepted.redirectTo).toContain("/onboard");
    expect(
      await loadMembershipRoleName(sql, officer.hqUserId, alliance.allianceId),
    ).toBe("officer");
    expect((await loadDiscordHqLink(sql, discordUserId))?.hqUserId).toBe(
      officer.hqUserId,
    );
  });

  test("browser accept flow with passphrase lands on onboard", async ({
    request,
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DB${nanoid(3)}`,
      name: `Discord Officer UI ${nanoid(4)}`,
    });
    const owner = await createAuthenticatedHqSession(sql, uniqueEmail("owner-ui-flow"));
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;

    const discordUserId = e2eDiscordUserId();
    const createRes = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(owner) },
      data: {
        kind: "discord_officer",
        roleName: "officer",
        targetDiscordUserId: discordUserId,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as {
      invite?: { inviteUrl: string; passphrase?: string };
    };
    const token = extractInviteToken(created.invite!.inviteUrl);
    const passphrase = created.invite!.passphrase!;

    const officerEmail = uniqueEmail("discord-officer-ui");
    const officer = await createAuthenticatedHqSession(sql, officerEmail);
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: officer.hqUserId,
      discordUserId,
    });

    await page.context().addCookies(playwrightAuthCookies(officer));
    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await expect(page.getByLabel(/passphrase/i)).toBeVisible();
    await page.getByLabel(/passphrase/i).fill(passphrase);
    await page.getByRole("button", { name: /accept invite/i }).click();
    await expect(page).toHaveURL(/\/onboard/);
  });

  test("reject when Discord account does not match invite target", async ({
    request,
    baseURL,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DM${nanoid(3)}`,
      name: `Discord Mismatch ${nanoid(4)}`,
    });
    const owner = await createAuthenticatedHqSession(sql, uniqueEmail("owner-mismatch"));
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;

    const targetDiscordUserId = e2eDiscordUserId();
    const createRes = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(owner) },
      data: {
        kind: "discord_officer",
        roleName: "officer",
        targetDiscordUserId,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as {
      invite?: { inviteUrl: string; passphrase?: string };
    };
    const token = extractInviteToken(created.invite!.inviteUrl);

    const invitee = await createAuthenticatedHqSession(sql, uniqueEmail("wrong-discord"));
    await createHqDiscordOAuthAccount(sql, {
      hqUserId: invitee.hqUserId,
      discordUserId: e2eDiscordUserId(),
    });

    const res = await fetch(`${baseURL}/api/invite/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader(invitee),
      },
      body: JSON.stringify({
        passphrase: created.invite!.passphrase,
        displayName: "Wrong Discord",
      }),
    });
    const body = (await res.json()) as { code?: string; error?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("discord_user_mismatch");
  });

  test("reject when HQ account has no linked Discord OAuth", async ({
    request,
    baseURL,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DL${nanoid(3)}`,
      name: `Discord Login Required ${nanoid(4)}`,
    });
    const owner = await createAuthenticatedHqSession(sql, uniqueEmail("owner-no-discord"));
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;

    const createRes = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(owner) },
      data: {
        kind: "discord_officer",
        roleName: "officer",
        targetDiscordUserId: e2eDiscordUserId(),
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as {
      invite?: { inviteUrl: string; passphrase?: string };
    };
    const token = extractInviteToken(created.invite!.inviteUrl);
    const invitee = await createAuthenticatedHqSession(sql, uniqueEmail("no-discord"));

    const res = await fetch(`${baseURL}/api/invite/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookieHeader(invitee),
      },
      body: JSON.stringify({
        passphrase: created.invite!.passphrase,
        displayName: "No Discord",
      }),
    });
    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("discord_login_required");
  });

  test("officer cannot create discord_officer invite (cannot assign officer role)", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DB${nanoid(3)}`,
      name: `Discord Officer Block ${nanoid(4)}`,
    });
    const officer = await createAuthenticatedHqSession(sql, uniqueEmail("officer-block"));
    await createAllianceMembership(sql, {
      hqUserId: officer.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${officer.sessionId}
    `;

    const res = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(officer) },
      data: {
        kind: "discord_officer",
        roleName: "officer",
        targetDiscordUserId: e2eDiscordUserId(),
      },
    });
    expect(res.status()).toBe(403);
  });

  test("unauthenticated invite preview prompts Discord sign-in", async ({
    request,
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `DU${nanoid(3)}`,
      name: `Discord Unauth ${nanoid(4)}`,
    });
    const owner = await createAuthenticatedHqSession(sql, uniqueEmail("owner-ui"));
    await createAllianceMembership(sql, {
      hqUserId: owner.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}, alliance_tag = ${alliance.tag}
      WHERE id = ${owner.sessionId}
    `;

    const createRes = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(owner) },
      data: {
        kind: "discord_officer",
        roleName: "officer",
        targetDiscordUserId: e2eDiscordUserId(),
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as { invite?: { inviteUrl: string } };
    const token = extractInviteToken(created.invite!.inviteUrl);

    const previewRes = await request.get(`/api/invite/${encodeURIComponent(token)}`);
    expect(previewRes.ok()).toBeTruthy();
    const preview = (await previewRes.json()) as {
      invite?: { requiresDiscordLogin?: boolean; requiresPassphrase?: boolean };
    };
    expect(preview.invite?.requiresDiscordLogin).toBe(true);
    expect(preview.invite?.requiresPassphrase).toBe(true);

    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await expect(page.getByRole("button", { name: /sign in with discord/i })).toBeVisible();
  });
});
