import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countShareActivityForOwnerOnDate,
  toPublicCredentialShareAuditEntry,
} from "@/lib/ashed/credential-share-audit.server";

const selectMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: selectMock,
  }),
  schema: {
    auditLog: {
      resourceType: "auditLog.resourceType",
      hqUserId: "auditLog.hqUserId",
      metadata: "auditLog.metadata",
      createdAt: "auditLog.createdAt",
    },
  },
}));

function chainSelectCount(count: number) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count }]),
    }),
  };
}

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

describe("countShareActivityForOwnerOnDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts owner-attributed activity including delegate usage", async () => {
    selectMock.mockReturnValueOnce(chainSelectCount(4));

    const count = await countShareActivityForOwnerOnDate(
      "owner-user",
      new Date("2026-07-30T00:00:00.000Z"),
      new Date("2026-07-31T00:00:00.000Z"),
    );

    expect(count).toBe(4);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns zero when no rows match", async () => {
    selectMock.mockReturnValueOnce(chainSelectCount(0));

    const count = await countShareActivityForOwnerOnDate(
      "owner-user",
      new Date("2026-07-30T00:00:00.000Z"),
      new Date("2026-07-31T00:00:00.000Z"),
    );

    expect(count).toBe(0);
  });
});
