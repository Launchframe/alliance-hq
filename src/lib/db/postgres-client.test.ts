import { describe, expect, it } from "vitest";

import { withPostgresAuthRecovery } from "./postgres-client";

describe("withPostgresAuthRecovery", () => {
  it("retries once after 28P01 auth failure", async () => {
    let attempts = 0;

    const result = await withPostgresAuthRecovery(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("password authentication failed"), {
          code: "28P01",
        });
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry non-auth errors", async () => {
    await expect(
      withPostgresAuthRecovery(async () => {
        throw Object.assign(new Error("too many clients"), { code: "53300" });
      }),
    ).rejects.toMatchObject({ code: "53300" });
  });
});
