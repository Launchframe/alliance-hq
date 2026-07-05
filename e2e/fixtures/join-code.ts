import { expect, type Page } from "@playwright/test";

/**
 * Fill the join-code field, submit, and wait for a successful redeem API
 * response before asserting navigation.
 */
export async function redeemJoinCodeInPage(
  page: Page,
  code: string,
  options?: { expectUrl?: RegExp; timeoutMs?: number },
): Promise<void> {
  const input = page.getByLabel(/join code/i);
  await expect(input).toBeVisible();
  await input.fill(code);
  await expect(input).toHaveValue(code);

  const redeemResponse = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.endsWith("/api/join-codes/redeem") &&
      res.request().method() === "POST",
  );
  await page.getByRole("button", { name: /join alliance/i }).click();
  const response = await redeemResponse;

  if (response.ok() && options?.expectUrl) {
    // JoinCodeClient uses window.location.assign on success; the response
    // body is often unavailable once navigation starts.
    await expect(page).toHaveURL(options.expectUrl, {
      timeout: options.timeoutMs ?? 15_000,
    });
    return;
  }

  const body = (await response.json()) as { error?: string; redirectTo?: string };
  expect(response.ok(), body.error ?? "join-code redeem failed").toBe(true);

  if (options?.expectUrl) {
    await expect(page).toHaveURL(options.expectUrl, {
      timeout: options.timeoutMs ?? 15_000,
    });
  }
}
