import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";

vi.mock("@/lib/ashed/rebind-session", () => ({
  revokeAshedMembershipsForHqUser: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/member-link/inherit-hq-to-discord.server", () => ({
  inheritHqMemberLinksToDiscord: vi.fn().mockResolvedValue({
    inherited: 0,
    skipped: 0,
  }),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  assessMergeHqUsers,
} from "./merge-hq-users.server";

type HqUserRow = {
  id: string;
  email: string;
  ashedUserId: string | null;
  isPlatformMaintainer: number;
};

type DiscordRow = {
  discordUserId: string;
};

type MemberLinkRow = {
  allianceId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
};

type AssessFixture = {
  canonical: HqUserRow;
  source: HqUserRow;
  canonicalDiscord?: DiscordRow | null;
  sourceDiscord?: DiscordRow | null;
  canonicalLinks?: MemberLinkRow[];
  sourceLinks?: MemberLinkRow[];
  canonicalMemberships?: { allianceId: string }[];
  sourceMemberships?: { allianceId: string }[];
  sourceAuthCount?: number;
  sourceCommanderCount?: number;
  sourceInvites?: { id: string }[];
};

function chainLimit(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function chainWhere(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function chainCount(count: number) {
  return chainWhere([{ count }]);
}

function installAssessDb(fixture: AssessFixture) {
  const select = vi.fn();
  select
    .mockReturnValueOnce(chainLimit([fixture.canonical]))
    .mockReturnValueOnce(chainLimit([fixture.source]))
    .mockReturnValueOnce(
      chainLimit(fixture.canonicalDiscord ? [fixture.canonicalDiscord] : []),
    )
    .mockReturnValueOnce(
      chainLimit(fixture.sourceDiscord ? [fixture.sourceDiscord] : []),
    )
    .mockReturnValueOnce(chainWhere(fixture.canonicalLinks ?? []))
    .mockReturnValueOnce(chainWhere(fixture.sourceLinks ?? []))
    .mockReturnValueOnce(chainWhere(fixture.sourceMemberships ?? []))
    .mockReturnValueOnce(chainWhere(fixture.canonicalMemberships ?? []));

  if (fixture.sourceAuthCount !== undefined) {
    select.mockReturnValueOnce(chainCount(fixture.sourceAuthCount));
  }

  if (fixture.sourceCommanderCount !== undefined) {
    select.mockReturnValueOnce(chainCount(fixture.sourceCommanderCount));
  }

  if (fixture.sourceInvites !== undefined) {
    select.mockReturnValueOnce(chainLimit(fixture.sourceInvites));
  }

  vi.spyOn(dbModule, "getDb").mockReturnValue({ select } as never);
  return select;
}

const baseCanonical: HqUserRow = {
  id: "canonical",
  email: "a@example.com",
  ashedUserId: null,
  isPlatformMaintainer: 0,
};

const baseSource: HqUserRow = {
  id: "source",
  email: "b@example.com",
  ashedUserId: null,
  isPlatformMaintainer: 0,
};

describe("assessMergeHqUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when canonical and source are the same account", async () => {
    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "user-1",
        sourceHqUserId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "same_account" });
  });

  it("rejects when source user row is missing", async () => {
    vi.spyOn(dbModule, "getDb").mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValueOnce([
                {
                  id: "canonical",
                  email: "a@example.com",
                  ashedUserId: null,
                  isPlatformMaintainer: 0,
                },
              ])
              .mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never);

    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "canonical",
        sourceHqUserId: "source",
      }),
    ).rejects.toMatchObject({ code: "source_not_found" });
  });

  it("rejects platform maintainer accounts", async () => {
    installAssessDb({
      canonical: baseCanonical,
      source: { ...baseSource, isPlatformMaintainer: 1 },
    });

    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "canonical",
        sourceHqUserId: "source",
      }),
    ).rejects.toMatchObject({ code: "platform_maintainer" });
  });

  it("rejects when both accounts have different Ashed identities", async () => {
    installAssessDb({
      canonical: { ...baseCanonical, ashedUserId: "ashed-a" },
      source: { ...baseSource, ashedUserId: "ashed-b" },
    });

    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "canonical",
        sourceHqUserId: "source",
      }),
    ).rejects.toMatchObject({ code: "ashed_identity_conflict" });
  });

  it("rejects when both accounts are linked to different Discord users", async () => {
    installAssessDb({
      canonical: baseCanonical,
      source: baseSource,
      canonicalDiscord: { discordUserId: "discord-a" },
      sourceDiscord: { discordUserId: "discord-b" },
    });

    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "canonical",
        sourceHqUserId: "source",
      }),
    ).rejects.toMatchObject({ code: "discord_conflict" });
  });

  it("rejects when both accounts have different commanders in the same alliance", async () => {
    installAssessDb({
      canonical: baseCanonical,
      source: baseSource,
      canonicalLinks: [
        {
          allianceId: "alliance-1",
          ashedMemberId: "member-a",
          memberDisplayName: "Alpha",
        },
      ],
      sourceLinks: [
        {
          allianceId: "alliance-1",
          ashedMemberId: "member-b",
          memberDisplayName: "Bravo",
        },
      ],
    });

    await expect(
      assessMergeHqUsers({
        canonicalHqUserId: "canonical",
        sourceHqUserId: "source",
      }),
    ).rejects.toMatchObject({ code: "commander_conflict" });
  });

  it("allows merge when canonical has no ashedUserId and source does", async () => {
    installAssessDb({
      canonical: baseCanonical,
      source: { ...baseSource, ashedUserId: "ashed-source" },
      sourceAuthCount: 0,
      sourceCommanderCount: 0,
    });

    const preview = await assessMergeHqUsers({
      canonicalHqUserId: "canonical",
      sourceHqUserId: "source",
    });

    expect(preview.sourceEmail).toBe("b@example.com");
    expect(preview.alliances).toEqual([]);
  });
});
