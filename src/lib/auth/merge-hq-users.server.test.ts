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

import { ROLE_IDS } from "@/lib/rbac/constants";

import {
  assessMergeHqUsers,
  mergeAllianceMembershipsIntoCanonical,
  preferredMembershipRoleId,
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

describe("preferredMembershipRoleId", () => {
  it("keeps the higher privilege role from either account", () => {
    expect(
      preferredMembershipRoleId(ROLE_IDS.member, ROLE_IDS.owner),
    ).toBe(ROLE_IDS.owner);
    expect(
      preferredMembershipRoleId(ROLE_IDS.owner, ROLE_IDS.member),
    ).toBe(ROLE_IDS.owner);
    expect(
      preferredMembershipRoleId(ROLE_IDS.officer, ROLE_IDS.officer),
    ).toBe(ROLE_IDS.officer);
  });

  it("keeps the canonical role when either side is not a system role", () => {
    expect(
      preferredMembershipRoleId("custom-role", ROLE_IDS.owner),
    ).toBe("custom-role");
    expect(
      preferredMembershipRoleId(ROLE_IDS.member, "custom-role"),
    ).toBe(ROLE_IDS.member);
  });

  it("proves revoked ashed seats escalate without an active-only filter", () => {
    // BUG (pre-fix path): after revokeAshedMembershipsForHqUser, the source
    // still had a status=revoked ashed owner row. Selecting every membership
    // (no status filter) fed that owner roleId into preferredMembershipRoleId
    // and permanently upgraded the canonical manual member seat.
    const sourceAfterRevoke = [
      { status: "revoked", roleId: ROLE_IDS.owner },
      { status: "active", roleId: ROLE_IDS.member },
    ];
    expect(
      preferredMembershipRoleId(
        ROLE_IDS.member,
        sourceAfterRevoke[0]!.roleId,
      ),
    ).toBe(ROLE_IDS.owner);

    // FIX: only status=active seats participate in role merge / transfer.
    const transferable = sourceAfterRevoke.filter(
      (row) => row.status === "active",
    );
    expect(transferable).toEqual([
      { status: "active", roleId: ROLE_IDS.member },
    ]);
    expect(
      preferredMembershipRoleId(ROLE_IDS.member, transferable[0]!.roleId),
    ).toBe(ROLE_IDS.member);
  });
});

type MembershipRow = {
  id: string;
  allianceId: string;
  hqUserId: string;
  roleId: string;
  status: string;
};

type MembershipWrite =
  | { kind: "update"; id: string; set: Record<string, unknown> }
  | { kind: "delete"; id: string };

function whereParamValue(condition: unknown): string {
  const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
  const param = chunks.find(
    (chunk) =>
      chunk !== null &&
      typeof chunk === "object" &&
      (chunk as { constructor: { name: string } }).constructor.name ===
        "Param",
  ) as { value: string } | undefined;
  if (!param) throw new Error("expected eq(id, value) condition");
  return param.value;
}

function membershipTx(rows: MembershipRow[]) {
  const writes: MembershipWrite[] = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((set: Record<string, unknown>) => ({
        where: vi.fn(async (condition: unknown) => {
          writes.push({ kind: "update", id: whereParamValue(condition), set });
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (condition: unknown) => {
        writes.push({ kind: "delete", id: whereParamValue(condition) });
      }),
    })),
  };
  return { tx: tx as never, writes };
}

describe("mergeAllianceMembershipsIntoCanonical", () => {
  const now = new Date("2026-10-11T00:00:00.000Z");
  const ids = { sourceId: "source", canonicalId: "canonical", now };

  it("does not upgrade the canonical seat from a revoked ashed owner row", async () => {
    const { tx, writes } = membershipTx([
      {
        id: "canonical-manual",
        allianceId: "alliance-1",
        hqUserId: "canonical",
        roleId: ROLE_IDS.member,
        status: "active",
      },
      {
        id: "source-ashed-owner",
        allianceId: "alliance-1",
        hqUserId: "source",
        roleId: ROLE_IDS.owner,
        status: "revoked",
      },
    ]);

    await mergeAllianceMembershipsIntoCanonical(tx, ids);

    expect(writes).toEqual([]);
  });

  it("upgrades from an active source seat and drops the source row", async () => {
    const { tx, writes } = membershipTx([
      {
        id: "canonical-manual",
        allianceId: "alliance-1",
        hqUserId: "canonical",
        roleId: ROLE_IDS.member,
        status: "active",
      },
      {
        id: "source-manual-officer",
        allianceId: "alliance-1",
        hqUserId: "source",
        roleId: ROLE_IDS.officer,
        status: "active",
      },
    ]);

    await mergeAllianceMembershipsIntoCanonical(tx, ids);

    expect(writes).toEqual([
      {
        kind: "update",
        id: "canonical-manual",
        set: { roleId: ROLE_IDS.officer, updatedAt: now },
      },
      { kind: "delete", id: "source-manual-officer" },
    ]);
  });

  it("replaces a revoked canonical tombstone before moving an active source seat", async () => {
    const { tx, writes } = membershipTx([
      {
        id: "canonical-revoked",
        allianceId: "alliance-1",
        hqUserId: "canonical",
        roleId: ROLE_IDS.owner,
        status: "revoked",
      },
      {
        id: "source-manual-member",
        allianceId: "alliance-1",
        hqUserId: "source",
        roleId: ROLE_IDS.member,
        status: "active",
      },
    ]);

    await mergeAllianceMembershipsIntoCanonical(tx, ids);

    expect(writes).toEqual([
      { kind: "delete", id: "canonical-revoked" },
      {
        kind: "update",
        id: "source-manual-member",
        set: { hqUserId: "canonical", updatedAt: now },
      },
    ]);
  });
});
