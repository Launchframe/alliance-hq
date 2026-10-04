import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkByAllianceAndMember: vi.fn(),
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds: vi.fn(),
  getDiscordLinkByAllianceAndMember: vi.fn(),
  getDiscordHqLink: vi.fn(),
}));

import { getHqMemberLinkByAllianceAndMember } from "@/lib/member-link/repository.server";
import {
  getDiscordHqLink,
  getDiscordLinkByAllianceAndMember,
} from "@/lib/vr/repository";

import { resolveInviteClaimOccupancy } from "./invites";

describe("resolveInviteClaimOccupancy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns free when no HQ or Discord link occupies the seat", async () => {
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue(null as never);

    await expect(
      resolveInviteClaimOccupancy({
        allianceId: "a1",
        ashedMemberId: "m1",
        acceptorHqUserId: "bob",
      }),
    ).resolves.toBe("free");
  });

  it("returns held_by_acceptor when the HQ link belongs to the acceptor", async () => {
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue({
      hqUserId: "bob",
      ashedMemberId: "m1",
    } as never);

    await expect(
      resolveInviteClaimOccupancy({
        allianceId: "a1",
        ashedMemberId: "m1",
        acceptorHqUserId: "bob",
      }),
    ).resolves.toBe("held_by_acceptor");
    expect(getDiscordLinkByAllianceAndMember).not.toHaveBeenCalled();
  });

  it("returns held_by_other when a different HQ user holds the seat", async () => {
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue({
      hqUserId: "alice",
      ashedMemberId: "m1",
    } as never);

    await expect(
      resolveInviteClaimOccupancy({
        allianceId: "a1",
        ashedMemberId: "m1",
        acceptorHqUserId: "bob",
      }),
    ).resolves.toBe("held_by_other");
  });

  it("returns held_by_acceptor when Discord seat maps to the acceptor via discord_hq_links", async () => {
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue({
      discordUserId: "d-bob",
      ashedMemberId: "m1",
    } as never);
    vi.mocked(getDiscordHqLink).mockResolvedValue({
      discordUserId: "d-bob",
      hqUserId: "bob",
    } as never);

    await expect(
      resolveInviteClaimOccupancy({
        allianceId: "a1",
        ashedMemberId: "m1",
        acceptorHqUserId: "bob",
      }),
    ).resolves.toBe("held_by_acceptor");
  });

  it("returns held_by_other for Discord-only occupancy (no HQ mapping)", async () => {
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue({
      discordUserId: "d-alice",
      ashedMemberId: "m1",
    } as never);
    vi.mocked(getDiscordHqLink).mockResolvedValue(null as never);

    await expect(
      resolveInviteClaimOccupancy({
        allianceId: "a1",
        ashedMemberId: "m1",
        acceptorHqUserId: "bob",
      }),
    ).resolves.toBe("held_by_other");
  });

  it("returns held_by_other when Discord seat maps to a different HQ user", async () => {
    vi.mocked(getHqMemberLinkByAllianceAndMember).mockResolvedValue(null as never);
    vi.mocked(getDiscordLinkByAllianceAndMember).mockResolvedValue({
      discordUserId: "d-alice",
      ashedMemberId: "m1",
    } as never);
    vi.mocked(getDiscordHqLink).mockResolvedValue({
      discordUserId: "d-alice",
      hqUserId: "alice",
    } as never);

    await expect(
      resolveInviteClaimOccupancy({
        allianceId: "a1",
        ashedMemberId: "m1",
        acceptorHqUserId: "bob",
      }),
    ).resolves.toBe("held_by_other");
  });
});
