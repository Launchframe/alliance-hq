import { expect, test } from "@playwright/test";

import {
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createViewOnlyMember } from "./fixtures/view-only-member";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("My VR tracker", () => {
  test("linked member loads page and can bump VR", async ({ page }) => {
    const sql = getE2eSql();
    const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
      operatingMode: "native",
    });
    await page.context().addCookies(playwrightAuthCookies(member));

    const response = await page.goto("/my-vr");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { name: /^my vr$/i })).toBeVisible();
    await expect(page.getByTestId("my-vr-hero-value")).toHaveText("—");

    await page.getByTestId("my-vr-bump").click();
    await expect(page.getByTestId("my-vr-hero-value")).toHaveText("250", {
      timeout: 15_000,
    });
  });
});
