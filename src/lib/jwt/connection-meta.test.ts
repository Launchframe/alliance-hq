import { describe, expect, it } from "vitest";

import { buildAshedConnectionMeta } from "@/lib/jwt/connection-meta";

describe("buildAshedConnectionMeta", () => {
  it("formats token expiry without throwing when dateStyle is long", () => {
    const meta = buildAshedConnectionMeta(
      {
        tokenExpiresAt: new Date("2026-12-01T12:00:00.000Z"),
        expiryReminderDays: 14,
      },
      "en-US",
    );

    expect(meta.tokenExpiresAtFormatted).toBeTruthy();
    expect(meta.isTokenExpired).toBe(false);
  });
});
