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
});
