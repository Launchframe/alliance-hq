import { expect, test } from "@playwright/test";

test.describe("Discord bot public guide", () => {
  test("hub loads without authentication", async ({ page }) => {
    await page.goto("/guides/discord-bot");

    await expect(page).toHaveURL(/\/guides\/discord-bot/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Discord bot setup guide/i }),
    ).toBeVisible();
    await expect(page.getByText("What's your role in your alliance?")).toBeVisible();
    await expect(page).not.toHaveURL(/\/auth/);
  });

  test("role card opens flowchart and step detail", async ({ page }) => {
    await page.goto("/guides/discord-bot");

    await page.getByRole("link", { name: /I just want to link my commander/i }).click();
    await expect(page).toHaveURL(/\/guides\/discord-bot\/link-only$/);
    await expect(page.getByText("Tap a step for detailed instructions.")).toBeVisible();

    await page.getByRole("link", { name: /Link your commander/i }).first().click();
    await expect(page).toHaveURL(/\/guides\/discord-bot\/link-only\/link-self$/);
    await expect(page.getByRole("heading", { level: 2, name: "Instructions" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Troubleshooting" }),
    ).toBeVisible();
    await expect(page.getByText("Copying your name and UID")).toBeVisible();
  });

  test("r5 flow starts with add-bot step", async ({ page }) => {
    await page.goto("/guides/discord-bot/r5");

    await expect(page.getByRole("link", { name: /Add the bot to your Discord server/i }).first()).toBeVisible();

    await page.getByRole("link", { name: /Add the bot to your Discord server/i }).first().click();
    await expect(page).toHaveURL(/\/guides\/discord-bot\/r5\/install-bot$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Instructions" }),
    ).toBeVisible();
    await expect(page.getByText("Slash commands not showing up")).toBeVisible();
  });
});
