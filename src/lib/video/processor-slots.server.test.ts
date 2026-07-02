import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectCallIndex: 0,
  inserted: [] as unknown[],
  deleteCalls: 0,
}));

const mockDb = vi.hoisted(() => {
  function makeChain() {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.from = passthrough;
    chain.innerJoin = passthrough;
    chain.leftJoin = passthrough;
    chain.where = passthrough;
    chain.limit = passthrough;
    chain.orderBy = passthrough;
    chain.then = (resolve: (value: unknown) => void) => {
      const result = mockState.selectResults[mockState.selectCallIndex] ?? [];
      mockState.selectCallIndex += 1;
      resolve(result);
    };
    return chain;
  }

  return {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown) => {
        mockState.inserted.push(values);
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        mockState.deleteCalls += 1;
      }),
    })),
  };
});

const getRbacContext = vi.hoisted(() => vi.fn());
const getAllianceMembershipRbac = vi.hoisted(() => vi.fn());
const sessionHasPermissionForAlliance = vi.hoisted(() => vi.fn());
const loadSession = vi.hoisted(() => vi.fn());
const getAllianceOperatingMode = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...clauses: unknown[]) => clauses),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((col: unknown, values: unknown[]) => ({ col, values })),
}));

vi.mock("@/lib/native-alliance/operating-mode", () => ({
  getAllianceOperatingMode,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "new-processor-id",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  schema: {
    allianceVideoProcessors: {
      id: "avp.id",
      allianceId: "avp.allianceId",
      hqUserId: "avp.hqUserId",
      grantedByHqUserId: "avp.grantedByHqUserId",
      grantedAt: "avp.grantedAt",
    },
    hqUsers: {
      id: "hqUsers.id",
      email: "hqUsers.email",
      displayName: "hqUsers.displayName",
      ashedUserId: "hqUsers.ashedUserId",
    },
    allianceMemberships: {
      hqUserId: "am.hqUserId",
      allianceId: "am.allianceId",
      status: "am.status",
      roleId: "am.roleId",
    },
    roles: { id: "roles.id", name: "roles.name" },
    hqMemberLinks: {
      allianceId: "hml.allianceId",
      hqUserId: "hml.hqUserId",
      ashedMemberId: "hml.ashedMemberId",
      memberDisplayName: "hml.memberDisplayName",
    },
    allianceMembers: {
      allianceId: "amem.allianceId",
      ashedMemberId: "amem.ashedMemberId",
      currentName: "amem.currentName",
      status: "amem.status",
      allianceRank: "amem.allianceRank",
      allianceRankTitle: "amem.allianceRankTitle",
    },
  },
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext,
  getAllianceMembershipRbac,
  sessionHasPermissionForAlliance,
}));

vi.mock("@/lib/session", () => ({
  loadSession,
}));

import {
  MAX_VIDEO_PROCESSORS,
  grantVideoProcessor,
  isAllianceVideoProcessor,
  listVideoProcessorCandidates,
  revokeVideoProcessor,
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";

beforeEach(() => {
  mockState.selectResults = [];
  mockState.selectCallIndex = 0;
  mockState.inserted = [];
  mockState.deleteCalls = 0;
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  mockDb.delete.mockClear();
  getRbacContext.mockReset();
  getAllianceMembershipRbac.mockReset();
  sessionHasPermissionForAlliance.mockReset();
  loadSession.mockReset();
  getAllianceOperatingMode.mockReset();
  loadSession.mockResolvedValue({
    id: "s",
    hqUserId: "u",
    currentAllianceId: "alliance-1",
    allianceId: null,
  });
});

describe("grantVideoProcessor", () => {
  it("is a no-op when the user already holds a slot", async () => {
    mockState.selectResults = [[{ id: "existing" }]];

    const result = await grantVideoProcessor({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      grantedByHqUserId: "admin-1",
    });

    expect(result).toEqual({ ok: true, alreadyGranted: true });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("rejects when all slots are full", async () => {
    // not existing, then count returns MAX rows
    mockState.selectResults = [
      [],
      Array.from({ length: MAX_VIDEO_PROCESSORS }, (_, i) => ({ id: `p${i}` })),
    ];

    const result = await grantVideoProcessor({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      grantedByHqUserId: "admin-1",
    });

    expect(result).toEqual({ ok: false, code: "slots_full" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("grants a slot when capacity remains", async () => {
    mockState.selectResults = [[], []];

    const result = await grantVideoProcessor({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      grantedByHqUserId: "admin-1",
    });

    expect(result).toEqual({ ok: true, alreadyGranted: false });
    expect(mockDb.insert).toHaveBeenCalledOnce();
    const inserted = mockState.inserted[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      id: "new-processor-id",
      allianceId: "alliance-1",
      hqUserId: "user-1",
      grantedByHqUserId: "admin-1",
    });
  });
});

describe("revokeVideoProcessor", () => {
  it("deletes the slot row", async () => {
    await revokeVideoProcessor({ allianceId: "alliance-1", hqUserId: "user-1" });
    expect(mockState.deleteCalls).toBe(1);
  });
});

describe("isAllianceVideoProcessor", () => {
  it("returns true when a slot row exists", async () => {
    mockState.selectResults = [[{ id: "slot" }]];
    await expect(isAllianceVideoProcessor("a", "u")).resolves.toBe(true);
  });

  it("returns false when no slot row exists", async () => {
    mockState.selectResults = [[]];
    await expect(isAllianceVideoProcessor("a", "u")).resolves.toBe(false);
  });
});

describe("sessionCanProcessVideo", () => {
  it("denies when there is no rbac context", async () => {
    getRbacContext.mockResolvedValue(null);
    await expect(sessionCanProcessVideo("s")).resolves.toBe(false);
  });

  it("allows platform maintainers without a slot", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: true,
      roleName: null,
      currentAllianceId: null,
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    await expect(sessionCanProcessVideo("s")).resolves.toBe(true);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("allows owners and maintainers via bypass role", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "owner",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    getAllianceMembershipRbac.mockResolvedValue({
      roleName: "owner",
      permissions: new Set<string>(),
    });
    await expect(sessionCanProcessVideo("s")).resolves.toBe(true);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("denies an officer without an alliance context", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: null,
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    await expect(sessionCanProcessVideo("s")).resolves.toBe(false);
  });

  it("allows an officer who holds a processor slot", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    getAllianceMembershipRbac.mockResolvedValue({
      roleName: "officer",
      permissions: new Set<string>(),
    });
    mockState.selectResults = [[{ id: "slot" }]];
    await expect(sessionCanProcessVideo("s")).resolves.toBe(true);
  });

  it("denies an officer without a processor slot", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    getAllianceMembershipRbac.mockResolvedValue({
      roleName: "officer",
      permissions: new Set<string>(),
    });
    mockState.selectResults = [[]];
    await expect(sessionCanProcessVideo("s")).resolves.toBe(false);
  });
});

describe("sessionCanReadAllianceVideoQueue", () => {
  it("denies when there is no session hq user", async () => {
    loadSession.mockResolvedValue(null);
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(false);
  });

  it("denies when there is no rbac context", async () => {
    getRbacContext.mockResolvedValue(null);
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(false);
  });

  it("allows platform maintainers", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: true,
      roleName: null,
      currentAllianceId: null,
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(true);
  });

  it("allows holders of hq:video:read in the alliance", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "owner",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    sessionHasPermissionForAlliance.mockImplementation(
      async (_sessionId, _allianceId, permission) =>
        permission === "hq:video:read",
    );
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(true);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("allows a designated processor without the read permission", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    sessionHasPermissionForAlliance.mockResolvedValue(false);
    mockState.selectResults = [[{ id: "slot" }]];
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(true);
  });

  it("allows an officer with hq:video:enqueue in the alliance", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    sessionHasPermissionForAlliance.mockImplementation(
      async (_sessionId, _allianceId, permission) =>
        permission === "hq:video:enqueue",
    );
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(true);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("denies an officer with neither permission nor slot", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    sessionHasPermissionForAlliance.mockResolvedValue(false);
    mockState.selectResults = [[]];
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(false);
  });
});

describe("listVideoProcessorCandidates", () => {
  it("returns ashed-connected officers for ashed alliances", async () => {
    getAllianceOperatingMode.mockResolvedValue("ashed");
    mockState.selectResults = [
      [
        {
          hqUserId: "officer-1",
          email: "a@e2e.test",
          displayName: "Officer A",
          ashedUserId: "ashed-1",
        },
        {
          hqUserId: "officer-2",
          email: "b@e2e.test",
          displayName: "Officer B",
          ashedUserId: null,
        },
      ],
    ];

    const result = await listVideoProcessorCandidates("alliance-1");
    expect(result.eligibilityMode).toBe("ashed_connected_officers");
    expect(result.candidates).toEqual([
      {
        hqUserId: "officer-1",
        email: "a@e2e.test",
        displayName: "Officer A",
        subtitle: null,
      },
    ]);
  });

  it("returns linked R4/R5 members for native alliances", async () => {
    getAllianceOperatingMode.mockResolvedValue("native");
    mockState.selectResults = [
      [
        {
          hqUserId: "user-r4",
          email: "r4@e2e.test",
          displayName: "HQ R4",
          memberDisplayName: "Commander R4",
          currentName: "Commander R4",
          allianceRank: 4,
          allianceRankTitle: "Warlord",
        },
        {
          hqUserId: "user-r5",
          email: "r5@e2e.test",
          displayName: null,
          memberDisplayName: "Leader One",
          currentName: "Leader One",
          allianceRank: 5,
          allianceRankTitle: "Leader",
        },
      ],
    ];

    const result = await listVideoProcessorCandidates("alliance-1");
    expect(result.eligibilityMode).toBe("native_r4_r5");
    expect(result.candidates).toEqual([
      {
        hqUserId: "user-r5",
        email: "r5@e2e.test",
        displayName: "Leader One",
        subtitle: "R5 · Leader",
      },
      {
        hqUserId: "user-r4",
        email: "r4@e2e.test",
        displayName: "HQ R4",
        subtitle: "R4 · Warlord",
      },
    ]);
  });
});
