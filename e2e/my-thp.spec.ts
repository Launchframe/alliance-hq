import { expect, test } from "@playwright/test";

import {
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createViewOnlyMember } from "./fixtures/view-only-member";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("My THP tracker", () => {
  test("linked member loads page and can set total THP", async ({ page }) => {
    const sql = getE2eSql();
    const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
      operatingMode: "native",
    });
    await page.context().addCookies(playwrightAuthCookies(member));

    const response = await page.goto("/my-thp");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { name: /^my thp$/i })).toBeVisible();
    await expect(page.getByTestId("my-thp-hero-value")).toHaveText("—");

    await page.getByTestId("my-thp-set-total").click();
    await page.getByTestId("my-thp-set-total-input").fill("150000000");
    await page.getByTestId("my-thp-set-total-submit").click();

    await expect(page.getByTestId("my-thp-hero-value")).toHaveText("150,000,000", {
      timeout: 15_000,
    });
  });
});
