import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListHqAlliancesByTag = vi.fn();
const mockResolveAllianceByTag = vi.fn();
const mockEmailPlatformMaintainers = vi.fn();
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/vr/resolve-alliance-tag", () => ({
  listHqAlliancesByTag: (...args: unknown[]) => mockListHqAlliancesByTag(...args),
  resolveAllianceByTag: (...args: unknown[]) => mockResolveAllianceByTag(...args),
}));

vi.mock("@/lib/ops/platform-maintainer-alert.server", () => ({
  emailPlatformMaintainers: (...args: unknown[]) =>
    mockEmailPlatformMaintainers(...args),
}));

vi.mock("@/lib/vr/bot-setup", () => ({
  isTagEligible: () => true,
}));

vi.mock("@/lib/vr/bot-user-context", () => ({
  discordAppBaseUrl: () => "https://example.test",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  schema: {
    hqAllianceSetupRequests: {
      id: "id",
      tag: "tag",
      allianceName: "alliance_name",
      gameServerNumber: "game_server_number",
      requesterHqUserId: "requester_hq_user_id",
      requesterEmail: "requester_email",
      discordUserId: "discord_user_id",
      status: "status",
      fulfilledAllianceId: "fulfilled_alliance_id",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
}));

import { createAllianceSetupRequest } from "./alliance-setup-request.server";

function chainSelect(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockDb.select.mockReturnValue(chain);
  return chain;
}

describe("createAllianceSetupRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAllianceByTag.mockResolvedValue({ ok: false, reason: "not_found" });
    mockListHqAlliancesByTag.mockResolvedValue([]);
    mockEmailPlatformMaintainers.mockResolvedValue({ sent: true, recipientCount: 1 });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns allianceReady when tag already exists on HQ", async () => {
    mockResolveAllianceByTag.mockResolvedValue({
      ok: true,
      alliance: { id: "a1", tag: "LFgo", name: "LF", ownerAshedUserId: null },
    });

    const result = await createAllianceSetupRequest({
      tag: "LFgo",
      allianceName: "LF",
      gameServerNumber: 1203,
      requesterHqUserId: "u1",
    });

    expect(result).toEqual({
      ok: true,
      created: false,
      allianceReady: true,
      allianceId: "a1",
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("creates a new open request when tag is not on HQ", async () => {
    chainSelect([]);

    const result = await createAllianceSetupRequest({
      tag: "LFgo",
      allianceName: "Last Frontier",
      gameServerNumber: 1203,
      requesterHqUserId: "u1",
      requesterEmail: "r5@example.test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.allianceReady) {
      throw new Error("expected pending setup request");
    }
    expect(result.created).toBe(true);
    expect(result.setupRequest.tag).toBe("LFgo");
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockEmailPlatformMaintainers).toHaveBeenCalled();
  });

  it("returns provision_request_open when another user already requested the tag", async () => {
    chainSelect([
      {
        id: "req1",
        tag: "LFgo",
        allianceName: "LF",
        gameServerNumber: 1203,
        requesterHqUserId: "other-user",
        requesterEmail: "other@example.test",
        discordUserId: null,
        status: "open",
        fulfilledAllianceId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await createAllianceSetupRequest({
      tag: "LFgo",
      allianceName: "LF",
      gameServerNumber: 1203,
      requesterHqUserId: "u1",
    });

    expect(result).toEqual({ ok: false, code: "provision_request_open" });
  });
});
