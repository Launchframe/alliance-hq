import { expect, test } from "@playwright/test";

/**
 * Credential share API gates — full accept/use/revoke flows need Ashed
 * connection fixtures; these tests lock session boundaries on new routes.
 */
test.describe("Credential share API gates", () => {
  test("extend requires an authenticated session", async ({ request }) => {
    const res = await request.post(
      "/api/settings/credential-shares/share-missing/extend",
      {
        data: { ttlHours: 24 },
      },
    );
    expect(res.status()).toBe(401);
  });

  test("account activity history requires an authenticated session", async ({
    request,
  }) => {
    const res = await request.get("/api/account/credential-shares/activity");
    expect(res.status()).toBe(401);
  });

  test("expire cron rejects missing CRON_SECRET", async ({ request }) => {
    const res = await request.get("/api/internal/ashed-credential-shares/expire");
    expect(res.status()).toBe(403);
  });

  test("team credential-shares create requires an authenticated session", async ({
    request,
  }) => {
    const res = await request.post("/api/settings/team/credential-shares", {
      data: {
        invitedHqUserId: "missing",
        capabilities: ["roster:sync"],
        ttlHours: 24,
      },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Team settings tabs deep link", () => {
  test("credential-shares tab query is accepted on team page redirect for anonymous", async ({
    page,
  }) => {
    await page.goto("/settings/team?tab=credential-shares");
    // Unauthenticated users are sent to auth / get-started; query should not 500.
    await expect(page).not.toHaveURL(/500/);
  });
});
