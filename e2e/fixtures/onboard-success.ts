import { expect, type Page } from "@playwright/test";

/**
 * After member-link success, Discord-linked users auto-redirect; email-only
 * users see "Continue to Alliance HQ" and must click through.
 */
export async function continueAfterMemberLinkSuccess(
  page: Page,
  options?: { expectUrl?: RegExp; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 20_000;

  await expect(page.getByRole("heading", { name: /you're linked/i })).toBeVisible({
    timeout: 15_000,
  });

  const continueLink = page.getByRole("link", {
    name: /continue to alliance hq/i,
  });
  if (await continueLink.isVisible().catch(() => false)) {
    await continueLink.click();
  }

  if (options?.expectUrl) {
    await expect(page).toHaveURL(options.expectUrl, { timeout: timeoutMs });
  }
}
