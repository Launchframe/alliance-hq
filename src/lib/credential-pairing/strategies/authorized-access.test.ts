import { describe, expect, it } from "vitest";

import { authorizedAccessStrategy } from "@/lib/credential-pairing/strategies/authorized-access";

describe("authorizedAccessStrategy", () => {
  it("rejects create until follow-up PR", async () => {
    await expect(
      authorizedAccessStrategy.validateCreate({
        sourceSession: {
          id: "sess-1",
          userLabel: null,
          allianceId: "a1",
          allianceTag: "LFgo",
          hqUserId: "hq-1",
          currentAllianceId: "alliance-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
        metadata: {},
      }),
    ).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
    });
  });
});
