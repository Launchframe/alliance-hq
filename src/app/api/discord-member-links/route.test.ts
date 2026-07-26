import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const requireSessionPermissionMock = vi.fn();
const listDiscordMemberLinksMock = vi.fn();
const upsertDiscordMemberLinkMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (sessionId: string, permission: string) =>
    requireSessionPermissionMock(sessionId, permission),
}));

vi.mock("@/lib/vr/repository", () => ({
  listDiscordMemberLinks: (allianceId: string) =>
    listDiscordMemberLinksMock(allianceId),
  upsertDiscordMemberLink: (input: unknown) =>
    upsertDiscordMemberLinkMock(input),
  deleteDiscordMemberLink: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: { discordMemberLinks: {} },
}));

import { GET, POST } from "./route";

describe("/api/discord-member-links UID privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-1",
      currentAllianceId: "alliance-1",
      allianceId: "alliance-1",
    });
    requireSessionPermissionMock.mockResolvedValue(null);
  });

  it("GET omits plaintext gameUid for members:write officers", async () => {
    listDiscordMemberLinksMock.mockResolvedValue([
      {
        id: "link-1",
        allianceId: "alliance-1",
        discordUserId: "discord-1",
        discordUsername: "alice",
        ashedMemberId: "member-1",
        memberDisplayName: "Alice",
        gameUid: "1234567890121203",
        linkedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(requireSessionPermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "members:write",
    );
    const body = (await res.json()) as {
      links: Array<Record<string, unknown>>;
    };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).not.toHaveProperty("gameUid");
    expect(body.links[0]?.gameUidLast4).toBe("1203");
    expect(JSON.stringify(body)).not.toContain("1234567890121203");
  });

  it("POST accepts gameUid for binding but does not echo it back", async () => {
    upsertDiscordMemberLinkMock.mockResolvedValue({
      id: "link-1",
      allianceId: "alliance-1",
      discordUserId: "discord-1",
      discordUsername: "alice",
      ashedMemberId: "member-1",
      memberDisplayName: "Alice",
      gameUid: "1234567890121203",
      linkedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(
      new Request("https://example.test/api/discord-member-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordUserId: "discord-1",
          ashedMemberId: "member-1",
          memberDisplayName: "Alice",
          gameUid: "1234567890121203",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(upsertDiscordMemberLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gameUid: "1234567890121203",
      }),
    );
    const body = (await res.json()) as { link: Record<string, unknown> };
    expect(body.link).not.toHaveProperty("gameUid");
    expect(body.link.gameUidLast4).toBe("1203");
    expect(JSON.stringify(body)).not.toContain("1234567890121203");
  });
});
