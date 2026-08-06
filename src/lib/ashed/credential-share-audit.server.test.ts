import { describe, expect, it } from "vitest";

import { toPublicCredentialShareAuditEntry } from "@/lib/ashed/credential-share-audit.server";

describe("credential-share-audit", () => {
  it("strips actor ids from public audit entries", () => {
    const publicEntry = toPublicCredentialShareAuditEntry({
      id: "audit-1",
      action: "ashed_share.used",
      allianceId: "alliance-1",
      hqUserId: "hq-delegate",
      shareId: "share-1",
      metadata: { delegateHqUserId: "hq-delegate", ownerHqUserId: "hq-owner" },
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    expect(publicEntry).toEqual({
      id: "audit-1",
      action: "ashed_share.used",
      shareId: "share-1",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    expect(publicEntry).not.toHaveProperty("hqUserId");
    expect(publicEntry).not.toHaveProperty("metadata");
  });
});
