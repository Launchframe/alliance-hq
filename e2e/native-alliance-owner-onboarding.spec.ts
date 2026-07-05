import { randomInt } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceJoinCodeRow,
  createAuthenticatedHqSession,
  createPlatformMaintainerSession,
  getE2eSql,
  loadAllianceGameServerNumber,
  playwrightAuthCookies,
} from "./fixtures/db";
import { redeemJoinCodeInPage } from "./fixtures/join-code";

const OWNER_COMMANDER_NAME = "E2eNativeOwner";

function buildE2eOwnerUid(serverNumber: number): string {
  return `1234567890${String(serverNumber).padStart(4, "0")}`;
}

function pickOwnerServerNumber(): number {
  return randomInt(1100, 9000);
}

function extractInviteToken(inviteUrl: string): string {
  const match = inviteUrl.match(/\/invite\/([^/?#]+)/);
  if (!match?.[1]) {
    throw new Error(`Could not parse invite token from URL: ${inviteUrl}`);
  }
  return decodeURIComponent(match[1]);
}

async function openMemberLinkForm(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(
    page.getByRole("heading", { name: /link your character/i }),
  ).toBeVisible();
}

/**
 * UID-only self-service: enter the player UID, preview the looked-up commander,
 * then confirm "yes, that's me" to fire the link submit. Returns the link POST
 * response (not the preview) so callers can assert the outcome.
 */
async function submitUidThenConfirm(
  page: import("@playwright/test").Page,
  uid: string,
) {
  await page.getByLabel(/player uid/i).fill(uid);
  await page.getByRole("button", { name: /link my commander/i }).click();
  const confirm = page.getByRole("button", { name: /yes, that's me/i });
  await expect(confirm).toBeVisible();
  const linkResponse = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.endsWith("/api/member-link") &&
      res.request().method() === "POST",
  );
  await confirm.click();
  return linkResponse;
}

test.describe("Native alliance — PA provision through owner onboarding", () => {
  test.slow();

  test("owner invite, officer join code, wrong-server block, owner onboarding", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const ownerServer = pickOwnerServerNumber();
    const ownerUid = buildE2eOwnerUid(ownerServer);
    const allianceTag = `NO${nanoid(3)}`;
    const allianceName = `Native Owner Onboarding ${nanoid(4)}`;

    // 1. Platform admin creates a native alliance with name, tag, and state server.
    const createRes = await request.post("/api/admin/native-alliances", {
      headers: { Cookie: authCookieHeader(maintainer) },
      data: {
        name: allianceName,
        tag: allianceTag,
        gameServerNumber: ownerServer,
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as {
      alliance?: { allianceId: string; tag: string };
    };
    const allianceId = created.alliance?.allianceId;
    expect(allianceId).toBeTruthy();
    expect(await loadAllianceGameServerNumber(sql, allianceId!)).toBe(ownerServer);

    // 2. PA generates owner protected-link invite; officer join code works once server is set.
    const ownerInviteRes = await request.post(
      `/api/admin/native-alliances/${encodeURIComponent(allianceId!)}/invites`,
      {
        headers: { Cookie: authCookieHeader(maintainer) },
        data: {
          kind: "protected_link",
          roleName: "owner",
          redirectPath: "/dashboard",
        },
      },
    );
    expect(ownerInviteRes.ok(), await ownerInviteRes.text()).toBeTruthy();
    const ownerInviteBody = (await ownerInviteRes.json()) as {
      invite?: { inviteUrl: string; passphrase?: string };
    };
    const ownerInviteUrl = ownerInviteBody.invite?.inviteUrl;
    const ownerPassphrase = ownerInviteBody.invite?.passphrase;
    expect(ownerInviteUrl).toContain("/invite/");
    expect(ownerPassphrase).toBeTruthy();

    const officerJoinCodeRes = await request.post(
      `/api/admin/native-alliances/${encodeURIComponent(allianceId!)}/join-codes`,
      {
        headers: { Cookie: authCookieHeader(maintainer) },
        data: {
          roleName: "officer",
          maxRedemptions: 5,
        },
      },
    );
    expect(officerJoinCodeRes.ok(), await officerJoinCodeRes.text()).toBeTruthy();

    // Seed an officer join code row to exercise early redemption before owner onboarding.
    const { code: officerJoinCode } = await createAllianceJoinCodeRow(sql, {
      allianceId: allianceId!,
      roleName: "officer",
      maxRedemptions: 5,
      createdByHqUserId: maintainer.hqUserId,
    });

    // 3. Officer redeems join code before owner links — blocked when UID server mismatches alliance.
    const officerServer = 5555;
    const officerUid = buildE2eOwnerUid(officerServer);
    const officerEmail = `officer-early-${nanoid(6)}@e2e.test`;
    const officerAuth = await createAuthenticatedHqSession(sql, officerEmail);
    await page.context().addCookies(playwrightAuthCookies(officerAuth));
    await page.goto("/join");
    await redeemJoinCodeInPage(page, officerJoinCode, { expectUrl: /\/onboard/ });

    await openMemberLinkForm(page);
    const officerLinkRes = await submitUidThenConfirm(page, officerUid);
    expect(officerLinkRes.ok()).toBe(true);
    const officerLinkBody = (await officerLinkRes.json()) as {
      outcome?: string;
      message?: string;
    };
    expect(
      officerLinkBody.outcome,
      officerLinkBody.message ?? "no message",
    ).toBe("wrong_server");
    expect(await loadAllianceGameServerNumber(sql, allianceId!)).toBe(ownerServer);

    // 4. Visitor redeems owner invite (protected link + passphrase).
    const ownerEmail = `owner-${nanoid(6)}@e2e.test`;
    const ownerAuth = await createAuthenticatedHqSession(sql, ownerEmail);
    const ownerInviteToken = extractInviteToken(ownerInviteUrl!);

    await page.context().clearCookies();
    await page.context().addCookies(playwrightAuthCookies(ownerAuth));
    await page.goto(`/invite/${encodeURIComponent(ownerInviteToken!)}`);
    await page.getByLabel(/passphrase/i).fill(ownerPassphrase!);
    await page.getByRole("button", { name: /accept invite/i }).click();
    await expect(page).toHaveURL(/\/onboard/);

    // 5. Owner onboarding: UID-only confirm matching the provisioned state server.
    await openMemberLinkForm(page);
    const response = await submitUidThenConfirm(page, ownerUid);
    expect(response.ok()).toBe(true);
    const linkBody = (await response.json()) as {
      outcome?: string;
      message?: string;
    };
    expect(linkBody.outcome, linkBody.message ?? "no message").toBe("linked");

    await expect(
      page.getByRole("heading", { name: /you're linked/i }),
    ).toBeVisible({ timeout: 15_000 });

    // 6. Owner reaches the app shell (native /dashboard → /members) with Ashed connect copy.
    await expect(page).toHaveURL(/\/members$/, { timeout: 20_000 });
    await expect(
      page.getByText(/connect ashed for iframe tools and live roster sync/i),
    ).toBeVisible();

    await page.goto("/members");
    await expect(page.getByRole("heading", { name: /^members$/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: OWNER_COMMANDER_NAME })).toBeVisible();
    await expect(page.getByText(/1 active/i)).toBeVisible();

    // 7. Alliance keeps the provisioned state server number.
    const linkedServer = await loadAllianceGameServerNumber(sql, allianceId!);
    expect(linkedServer).toBe(ownerServer);

    const [gameServerRow] = await sql<{ id: string; server_number: number }[]>`
      SELECT id, server_number
      FROM game_servers
      WHERE server_number = ${ownerServer}
      LIMIT 1
    `;
    expect(gameServerRow?.server_number).toBe(ownerServer);

    const [allianceRow] = await sql<
      { game_server_id: string | null; owner_hq_user_id: string | null }[]
    >`
      SELECT game_server_id, owner_hq_user_id
      FROM alliances
      WHERE id = ${allianceId}
      LIMIT 1
    `;
    expect(allianceRow?.game_server_id).toBe(gameServerRow?.id);
    expect(allianceRow?.owner_hq_user_id).toBe(ownerAuth.hqUserId);
  });
});
