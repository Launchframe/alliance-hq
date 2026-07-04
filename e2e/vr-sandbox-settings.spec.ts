import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type Page } from "@playwright/test";

import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

function waitForVrSandboxPatch(page: Page) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      res.url().includes("/vr-sandbox") &&
      res.ok(),
  );
}

test.describe("Alliance VR sandbox settings", () => {
  test("owner can enable and disable VR sandbox with confirmation", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const tag = `VS${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "VR Sandbox Settings Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("vr-sandbox-owner"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/trains");

    await expect(
      page.getByRole("heading", { name: /VR sandbox mode/i }),
    ).toBeVisible();

    const toggle = page.getByRole("checkbox", {
      name: /Enable VR sandbox for this alliance/i,
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    const enablePatch = waitForVrSandboxPatch(page);
    await toggle.click();
    await enablePatch;
    await expect(toggle).toBeChecked();
    await expect(
      page.getByText(/Sandbox is on — \/vr and My VR accept practice reports/i),
    ).toBeVisible();

    await toggle.click();
    await expect(
      page.getByText(/in-flight web VR confirmations will be cancelled/i),
    ).toBeVisible();

    const disablePatch = waitForVrSandboxPatch(page);
    await page
      .getByRole("button", { name: /End sandbox and wipe data/i })
      .click();
    await disablePatch;

    await expect(toggle).not.toBeChecked();
    await expect(
      page.getByText(/Sandbox is on — \/vr and My VR accept practice reports/i),
    ).not.toBeVisible();
  });

  test("viewer sees read-only VR sandbox hint", async ({ page }) => {
    const sql = getE2eSql();
    const tag = `VS${nanoid(4)}`;
    const alliance = await createNativeAlliance(sql, {
      tag,
      name: "VR Sandbox Viewer Alliance",
    });
    const auth = await createAuthenticatedHqSession(
      sql,
      uniqueEmail("vr-sandbox-viewer"),
    );
    await createAllianceMembership(sql, {
      hqUserId: auth.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "viewer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: auth.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${auth.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: auth.sessionId,
        nextAuthToken: auth.nextAuthToken,
      }),
    );

    await page.goto("/settings/trains");

    const toggle = page.getByRole("checkbox", {
      name: /Enable VR sandbox for this alliance/i,
    });
    await expect(toggle).toBeDisabled();
    await expect(
      page.getByText(/Only alliance admins can change this setting/i),
    ).toBeVisible();
  });
});
