import { expect, test } from "@playwright/test";

test.describe("Auth OAuth account linking errors", () => {
  test("OAuthAccountNotLinked error page shows updated guidance", async ({
    page,
  }) => {
    await page.goto("/auth/error?error=OAuthAccountNotLinked");

    await expect(
      page.getByRole("heading", {
        name: /This Google or Discord account is not linked/i,
      }),
    ).toBeVisible();

    await expect(
      page.getByText(/Discord can sign you in automatically when its verified email matches your invite/i),
    ).toBeVisible();

    await expect(
      page.getByText(/sign in with your invite email first/i),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Back to sign in/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Open sign-in & security settings/i }),
    ).toHaveAttribute("href", /\/settings\/account/);
  });

  test("auth sign-in page surfaces the same OAuthAccountNotLinked copy", async ({
    page,
  }) => {
    await page.goto("/auth?error=OAuthAccountNotLinked");

    await expect(
      page.getByText(/Discord can sign you in automatically when its verified email matches your invite/i),
    ).toBeVisible();
  });
});
