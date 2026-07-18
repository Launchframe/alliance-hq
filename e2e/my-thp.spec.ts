import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
  type Sql,
} from "./fixtures/db";

/** Minimal Commander + roster membership row so `/my-thp` resolves a commanderId for the linked member. */
async function insertCommanderMembership(
  sql: Sql,
  input: { allianceId: string; ashedMemberId: string; primaryName: string },
): Promise<{ commanderId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.primaryName},
      ${input.primaryName.toLowerCase()},
      ${input.allianceId},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${commanderId},
      ${input.allianceId},
      ${input.ashedMemberId},
      'active',
      ${now},
      ${now},
      ${now}
    )
  `;

  return { commanderId };
}

test.describe("My THP tracker", () => {
  test("linked member loads page and can set total THP", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TH${nanoid(3)}`,
      name: "My THP Alliance",
    });
    const email = `thp-member-${nanoid(6)}@e2e.test`;
    const session = await createAuthenticatedHqSession(sql, email);
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const { ashedMemberId } = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
      memberDisplayName: "E2E THP Commander",
    });
    await insertCommanderMembership(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      primaryName: "E2E THP Commander",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(session));

    const response = await page.goto("/my-thp");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { name: /^my thp$/i })).toBeVisible();
    await expect(page.getByTestId("my-thp-hero-value")).toHaveText("—");

    await page.getByTestId("my-thp-set-total").click();
    await page.getByTestId("my-thp-set-total-input").fill("125000000");
    await page.getByTestId("my-thp-set-total-submit").click();

    await expect(page.getByTestId("my-thp-hero-value")).toHaveText("125,000,000", {
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: /history/i }).click();
    await expect(page.getByText("125,000,000")).toBeVisible();
  });

  test("member without a linked commander is redirected to onboarding", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TN${nanoid(3)}`,
      name: "My THP No Commander Alliance",
    });
    const email = `thp-nolink-${nanoid(6)}@e2e.test`;
    const session = await createAuthenticatedHqSession(sql, email);
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(session));

    await page.goto("/my-thp");
    await expect(page).toHaveURL(/\/onboard/);
  });

  test("ocr_partial opens breakdown form prefilled with screenshot preview", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `TP${nanoid(3)}`,
      name: "My THP OCR Partial Alliance",
    });
    const email = `thp-ocr-partial-${nanoid(6)}@e2e.test`;
    const session = await createAuthenticatedHqSession(sql, email);
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const { ashedMemberId } = await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
      memberDisplayName: "E2E OCR Partial Commander",
    });
    await insertCommanderMembership(sql, {
      allianceId: alliance.allianceId,
      ashedMemberId,
      primaryName: "E2E OCR Partial Commander",
    });
    await sql`
      UPDATE sessions
      SET
        current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
      WHERE id = ${session.sessionId}
    `;
    await page.context().addCookies(playwrightAuthCookies(session));

    /** 1×1 PNG — OCR is stubbed via route; we only need a selectable image. */
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    await page.route("**/api/thp/me/submit", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ocr_partial",
          message: "Could not read a reliable total from the screenshot.",
          partialBreakdown: {
            heroLevel: 85_813_080,
            gear: 13_059_233,
            wallOfHonor: 4_702_700,
          },
        }),
      });
    });

    await page.goto("/my-thp");
    await expect(page.getByRole("heading", { name: /^my thp$/i })).toBeVisible();

    await page.getByTestId("my-thp-screenshot-input").setInputFiles({
      name: "power-details.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    await expect(page.getByTestId("my-thp-breakdown-form")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("my-thp-ocr-partial-hint")).toBeVisible();
    await expect(page.getByTestId("my-thp-breakdown-field-heroLevel")).toHaveValue(
      "85813080",
    );
    await expect(page.getByTestId("my-thp-breakdown-field-gear")).toHaveValue(
      "13059233",
    );
    await expect(page.getByTestId("my-thp-breakdown-field-wallOfHonor")).toHaveValue(
      "4702700",
    );
    await expect(page.getByTestId("my-thp-breakdown-preview-btn")).toBeVisible();

    await page.getByTestId("my-thp-breakdown-preview-btn").click();
    await expect(page.locator(".yarl__root")).toBeVisible();
  });
});
