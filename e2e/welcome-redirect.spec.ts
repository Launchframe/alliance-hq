import { nanoid } from "nanoid";
import { expect, test, type Page } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
  linkNativeAllianceToGameServer,
  playwrightAuthCookies,
} from "./fixtures/db";

function welcomePathFromAbsoluteUrl(welcomeUrl: string): string {
  const url = new URL(welcomeUrl);
  return `${url.pathname}${url.search}`;
}

async function assertNotApp404(page: Page) {
  await expect(
    page.getByRole("heading", { name: /page not found/i }),
  ).toHaveCount(0);
}

test.describe("Welcome claim share links (anti-404)", () => {
  test("officer welcomeUrl opens, does not 404, and lands on claim UID entry", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `WA${nanoid(3)}`,
      name: "Welcome Api Claim Alliance",
    });
    await linkNativeAllianceToGameServer(sql, alliance.allianceId, 1203);
    const { ashedMemberId } = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "E2eApiClaimTarget",
    });

    const officer = await createAuthenticatedHqSession(
      sql,
      `welcome-officer-${nanoid(6)}@e2e.test`,
    );
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

    // Same officer generate path the invite wizard uses (#210 share payload).
    const createRes = await request.post("/api/settings/team/invites", {
      headers: { Cookie: authCookieHeader(officer) },
      data: {
        kind: "protected_link",
        roleName: "member",
        targetAshedMemberId: ashedMemberId,
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as {
      joinCode?: {
        code?: string;
        welcomeUrl?: string | null;
        targetCommanderName?: string | null;
      };
    };
    const welcomeUrl = created.joinCode?.welcomeUrl?.trim() ?? "";
    const code = created.joinCode?.code?.trim() ?? "";
    expect(welcomeUrl).toMatch(/\/welcome\?/);
    expect(welcomeUrl).toContain(`tag=${encodeURIComponent(alliance.tag)}`);
    expect(welcomeUrl).toContain(`code=${encodeURIComponent(code)}`);
    expect(code.length).toBeGreaterThan(0);

    const recipient = await createAuthenticatedHqSession(
      sql,
      `welcome-claimant-${nanoid(6)}@e2e.test`,
    );
    await page.context().addCookies(playwrightAuthCookies(recipient));

    const welcomePath = welcomePathFromAbsoluteUrl(welcomeUrl);

    // Catch missing `/welcome` route the way the original production 404 failed.
    const firstHopStatusPromise = page.waitForResponse(
      (res) => {
        try {
          const path = new URL(res.url()).pathname;
          return (
            (path === "/welcome" || path.endsWith("/welcome")) &&
            res.request().method() === "GET"
          );
        } catch {
          return false;
        }
      },
      { timeout: 20_000 },
    );

    await page.goto(welcomePath);
    const welcomeResponse = await firstHopStatusPromise;
    expect(
      welcomeResponse.status(),
      `GET ${welcomePath} must not 404 (share links from invite API)`,
    ).not.toBe(404);

    await assertNotApp404(page);
    await expect(page).toHaveURL(/\/onboard/, { timeout: 20_000 });
    await assertNotApp404(page);

    await expect(
      page.getByRole("heading", { name: /confirm your commander/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/Your alliance invited you to claim E2eApiClaimTarget/i),
    ).toBeVisible();
    await expect(page.getByLabel(/player uid/i)).toBeVisible();
  });

  test("unknown /welcome?code= still serves /join (never app 404)", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `welcome-unknown-${nanoid(6)}@e2e.test`,
    );
    await page.context().addCookies(playwrightAuthCookies(session));

    const tag = `WX${nanoid(3)}`;
    const code = `${tag.toUpperCase()}-DEAD00`;
    const welcomePath = `/welcome?tag=${encodeURIComponent(tag)}&code=${encodeURIComponent(code)}`;

    const firstHopStatusPromise = page.waitForResponse((res) => {
      try {
        const path = new URL(res.url()).pathname;
        return (
          (path === "/welcome" || path.endsWith("/welcome")) &&
          res.request().method() === "GET"
        );
      } catch {
        return false;
      }
    });

    await page.goto(welcomePath);
    const welcomeResponse = await firstHopStatusPromise;
    expect(welcomeResponse.status()).not.toBe(404);

    await expect(page).toHaveURL(new RegExp(`/join\\?code=${code}`));
    await assertNotApp404(page);
    await expect(page.getByRole("heading", { name: /join an alliance/i })).toBeVisible();
    await expect(page.getByText(/join code not found/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
