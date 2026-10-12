import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

async function bootstrapSettingsPageSession(
  sql: ReturnType<typeof getE2eSql>,
  session: Awaited<ReturnType<typeof createAuthenticatedHqSession>>,
) {
  const alliance = await createNativeAlliance(sql, {
    tag: `PW${nanoid(3)}`,
    name: "Password Change Alliance",
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

async function loadPasswordHash(hqUserId: string): Promise<string | null> {
  const sql = getE2eSql();
  const [row] = await sql<{ password_hash: string | null }[]>`
    SELECT password_hash FROM hq_users WHERE id = ${hqUserId}
  `;
  return row?.password_hash ?? null;
}

test.describe("Account password change", () => {
  test("anonymous request cannot set a password", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176",
    });
    try {
      const res = await anonymous.post("/api/auth/password/set", {
        data: { password: "first-pass-123!", confirmPassword: "first-pass-123!" },
      });
      expect(res.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });

  test("first-time set needs no current password; changes require it", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createAuthenticatedHqSession(
      sql,
      `pw-${nanoid(6)}@alliance-hq.test`,
    );
    await bootstrapSettingsPageSession(sql, session);
    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: session.sessionId,
        nextAuthToken: session.nextAuthToken,
      }),
    );

    await page.goto("/settings/account");
    await expect(page.locator('input[autocomplete="new-password"]').first()).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);

    const firstPassword = `first-${nanoid(8)}!`;
    const setRes = await page.request.post("/api/auth/password/set", {
      data: { password: firstPassword, confirmPassword: firstPassword },
    });
    expect(setRes.ok()).toBeTruthy();
    const firstHash = await loadPasswordHash(session.hqUserId);
    expect(firstHash).toBeTruthy();

    const nextPassword = `next-${nanoid(8)}!`;

    const missingRes = await page.request.post("/api/auth/password/set", {
      data: { password: nextPassword, confirmPassword: nextPassword },
    });
    expect(missingRes.status()).toBe(400);
    expect(await missingRes.json()).toEqual({ error: "current_password_required" });

    const wrongRes = await page.request.post("/api/auth/password/set", {
      data: {
        password: nextPassword,
        confirmPassword: nextPassword,
        currentPassword: `wrong-${nanoid(8)}!`,
      },
    });
    expect(wrongRes.status()).toBe(400);
    expect(await wrongRes.json()).toEqual({ error: "current_password_incorrect" });
    expect(await loadPasswordHash(session.hqUserId)).toBe(firstHash);

    const changeRes = await page.request.post("/api/auth/password/set", {
      data: {
        password: nextPassword,
        confirmPassword: nextPassword,
        currentPassword: firstPassword,
      },
    });
    expect(changeRes.ok()).toBeTruthy();
    const nextHash = await loadPasswordHash(session.hqUserId);
    expect(nextHash).toBeTruthy();
    expect(nextHash).not.toBe(firstHash);

    await page.goto("/settings/account");
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
  });
});
