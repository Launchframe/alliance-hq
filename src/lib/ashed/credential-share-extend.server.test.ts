import { describe, expect, it } from "vitest";

import { resolveExtendedShareExpiresAt } from "@/lib/ashed/credential-share.server";

describe("resolveExtendedShareExpiresAt", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  it("adds ttl from now when share is expired or missing expiry", () => {
    const expiresAt = resolveExtendedShareExpiresAt(now, null, 24);
    expect(expiresAt.toISOString()).toBe("2026-08-02T12:00:00.000Z");
  });

  it("adds ttl from current expiry when share is still active", () => {
    const currentExpiresAt = new Date("2026-08-05T12:00:00.000Z");
    const expiresAt = resolveExtendedShareExpiresAt(now, currentExpiresAt, 24);
    expect(expiresAt.toISOString()).toBe("2026-08-06T12:00:00.000Z");
  });

  it("does not shorten access when current expiry is later than now + ttl", () => {
    const currentExpiresAt = new Date("2026-08-06T12:00:00.000Z");
    const expiresAt = resolveExtendedShareExpiresAt(now, currentExpiresAt, 24);
    expect(expiresAt.toISOString()).toBe("2026-08-07T12:00:00.000Z");
  });
});
