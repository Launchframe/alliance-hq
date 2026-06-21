import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  attachAshedConnectionToSession,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createCanonicalAshedHqUser,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("Invite auth gate", () => {
  test("unauthenticated visitor sees sign-in prompt, not accept form", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `IG${nanoid(3)}`,
      name: "Invite Gate Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    await page.goto(`/invite/${encodeURIComponent(token)}`);

    await expect(
      page.getByRole("link", { name: /sign in to accept/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/email/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /accept invite/i }),
    ).toHaveCount(0);

    const signInHref = await page
      .getByRole("link", { name: /sign in to accept/i })
      .getAttribute("href");
    expect(signInHref).toContain("/auth");
    expect(signInHref).toContain(encodeURIComponent(token));
  });

  test("invite accept API returns auth_required without NextAuth session", async () => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `IA${nanoid(3)}`,
      name: "Invite API Gate Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const res = await fetch(
      `${e2eBaseUrl()}/api/invite/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName: "E2E User" }),
      },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("auth_required");
    expect(body.error).toMatch(/sign in required/i);
  });

  test("HQ session cookie alone is not enough to accept invite via API", async () => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `IB${nanoid(3)}`,
      name: "Invite Browser-Only Gate Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const browserOnly = await createAuthenticatedHqSession(sql, email);

    const res = await fetch(
      `${e2eBaseUrl()}/api/invite/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `alliance_hq_session=${browserOnly.sessionId}`,
        },
        body: JSON.stringify({ email, displayName: "E2E User" }),
      },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("auth_required");
  });
});

test.describe("Get-started routing", () => {
  test("signed-in user without membership is redirected to /get-started from app routes", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const auth = await createAuthenticatedHqSession(sql, `lonely-${nanoid(6)}@e2e.test`);

    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto("/members");

    await expect(page).toHaveURL(/\/get-started/);
    await expect(page.getByRole("heading", { name: /almost there/i })).toBeVisible();
  });

  test("invite onboarding skip does not land on /get-started", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `GS${nanoid(3)}`,
      name: "Get Started Skip Alliance",
    });
    const email = `member-${nanoid(6)}@e2e.test`;
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email,
      roleName: "member",
      redirectPath: "/trains",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const auth = await createAuthenticatedHqSession(sql, email);
    await page.context().addCookies(playwrightAuthCookies(auth));
    await page.goto(`/invite/${encodeURIComponent(token)}`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole("button", { name: /accept invite/i }).click();

    await expect(page).toHaveURL(/\/connect\?welcome=1/);
    await page.getByRole("link", { name: /continue without ashed/i }).click();

    await expect(page).toHaveURL(/\/trains/);
    await expect(page).not.toHaveURL(/\/get-started/);
  });

  test("magic-link stub keeps app access after Ashed connect merge", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const ashedUserId = `ashed-${nanoid(12)}`;
    const magicEmail = `magic-${nanoid(6)}@e2e.test`;
    const gameEmail = `game-${nanoid(6)}@e2e.test`;

    const stubSession = await createAuthenticatedHqSession(sql, magicEmail);
    const alliance = await createNativeAlliance(sql, {
      tag: `PC${nanoid(3)}`,
      name: "Post Connect Alliance",
    });
    const { hqUserId: canonicalId } = await createCanonicalAshedHqUser(sql, {
      email: gameEmail,
      ashedUserId,
    });
    await createAllianceMembership(sql, {
      hqUserId: canonicalId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "ashed",
    });

    await attachAshedConnectionToSession(sql, stubSession.sessionId, {
      ashedUserId,
    });
    await sql`
      UPDATE sessions
      SET hq_user_id = ${canonicalId}, current_alliance_id = ${alliance.allianceId}
      WHERE id = ${stubSession.sessionId}
    `;
    await sql`
      INSERT INTO audit_log (
        id, session_id, alliance_id, hq_user_id, action, resource_type, resource_id, metadata, created_at
      ) VALUES (
        ${nanoid(16)},
        ${stubSession.sessionId},
        ${alliance.allianceId},
        ${canonicalId},
        ${"ashed.rebind"},
        ${"ashed_identity"},
        ${ashedUserId},
        ${sql.json({ mergedFromHqUserId: stubSession.hqUserId })},
        ${new Date()}
      )
    `;

    await page.context().addCookies(playwrightAuthCookies(stubSession));
    await page.goto("/");

    await expect(page).not.toHaveURL(/\/get-started/);
  });
});
