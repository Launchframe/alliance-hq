import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "./route";

const getOrCreateSession = vi.fn();
const requirePlatformMaintainer = vi.fn();
const listDiscordMemberLinks = vi.fn();
const upsertDiscordMemberLink = vi.fn();
const deleteDiscordMemberLink = vi.fn();
const selectLimit = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: (...args: unknown[]) => getOrCreateSession(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requirePlatformMaintainer: (...args: unknown[]) =>
    requirePlatformMaintainer(...args),
}));

vi.mock("@/lib/vr/repository", () => ({
  listDiscordMemberLinks: (...args: unknown[]) => listDiscordMemberLinks(...args),
  upsertDiscordMemberLink: (...args: unknown[]) => upsertDiscordMemberLink(...args),
  deleteDiscordMemberLink: (...args: unknown[]) => deleteDiscordMemberLink(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => selectLimit(...args),
        }),
      }),
    }),
  }),
  schema: {
    discordMemberLinks: {
      id: "id",
      allianceId: "allianceId",
    },
  },
}));

describe("/api/discord-member-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSession.mockResolvedValue({
      id: "sess-1",
      currentAllianceId: "ally-1",
      allianceId: "ally-1",
    });
    requirePlatformMaintainer.mockResolvedValue(null);
    listDiscordMemberLinks.mockResolvedValue([
      { id: "link-1", gameUid: "123456789012" },
    ]);
    upsertDiscordMemberLink.mockResolvedValue({ id: "link-1" });
    selectLimit.mockResolvedValue([
      { id: "link-1", allianceId: "ally-1" },
    ]);
  });

  it("rejects officer sessions without hq:admin on POST (no force-bind)", async () => {
    requirePlatformMaintainer.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST(
      new Request("http://localhost/api/discord-member-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordUserId: "attacker-discord",
          ashedMemberId: "owner-member",
          gameUid: "999999999999",
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(upsertDiscordMemberLink).not.toHaveBeenCalled();
  });

  it("rejects non-maintainers on GET (UID-bearing list)", async () => {
    requirePlatformMaintainer.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await GET();
    expect(res.status).toBe(403);
    expect(listDiscordMemberLinks).not.toHaveBeenCalled();
  });

  it("allows platform maintainers to force-bind", async () => {
    const res = await POST(
      new Request("http://localhost/api/discord-member-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordUserId: "discord-1",
          ashedMemberId: "member-1",
          gameUid: "123456789012",
          discordUsername: "Officer",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(upsertDiscordMemberLink).toHaveBeenCalledWith({
      allianceId: "ally-1",
      discordUserId: "discord-1",
      discordUsername: "Officer",
      ashedMemberId: "member-1",
      memberDisplayName: null,
      gameUid: "123456789012",
    });
  });

  it("rejects non-maintainers on DELETE", async () => {
    requirePlatformMaintainer.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await DELETE(
      new Request("http://localhost/api/discord-member-links?id=link-1", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(403);
    expect(deleteDiscordMemberLink).not.toHaveBeenCalled();
  });
});
