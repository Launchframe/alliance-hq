import { expect, test } from "@playwright/test";

import {
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Public landing page", () => {
  test("unauthenticated visitor sees marketing homepage without auth redirect", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Alliance HQ" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test("authenticated user is redirected away from public landing", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const session = await createPlatformMaintainerSession(sql);

    await page.context().addCookies(playwrightAuthCookies(session));
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Sign in" })).not.toBeVisible();
    await expect(page).not.toHaveURL(/\/$/);
  });
});
