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
      page.getByText(/Sign in with your HQ email first/i),
    ).toBeVisible();

    await expect(
      page.getByText(/Settings → Sign-in & security/i),
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
      page.getByText(/Sign in with your HQ email first/i),
    ).toBeVisible();
  });

  test("OAuthSignInRequired error page shows provider-specific guidance", async ({
    page,
  }) => {
    await page.goto(
      "/auth/error?error=OAuthSignInRequired&email=player%40example.com&providers=google",
    );

    await expect(
      page.getByRole("heading", { name: /Use Google or Discord to sign in/i }),
    ).toBeVisible();

    await expect(
      page.getByText(/Please sign in with Google using player@example.com/i),
    ).toBeVisible();

    await expect(
      page.getByText(/Email verification codes and magic links cannot be used/i),
    ).toBeVisible();
  });

  test("auth sign-in page surfaces OAuthSignInRequired guidance", async ({
    page,
  }) => {
    await page.goto(
      "/auth?error=OAuthSignInRequired&email=player%40example.com&providers=google",
    );

    await expect(
      page.getByText(/Please sign in with Google using player@example.com/i),
    ).toBeVisible();
  });
});
