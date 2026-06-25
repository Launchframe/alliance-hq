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

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...clauses: unknown[]) => clauses),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
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
    hqUsers: { id: "hqUsers.id", email: "hqUsers.email", displayName: "hqUsers.displayName" },
    allianceMemberships: {
      hqUserId: "am.hqUserId",
      allianceId: "am.allianceId",
      status: "am.status",
      roleId: "am.roleId",
    },
    roles: { id: "roles.id", name: "roles.name" },
  },
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext,
}));

import {
  MAX_VIDEO_PROCESSORS,
  grantVideoProcessor,
  isAllianceVideoProcessor,
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
    mockState.selectResults = [[]];
    await expect(sessionCanProcessVideo("s")).resolves.toBe(false);
  });
});

describe("sessionCanReadAllianceVideoQueue", () => {
  it("denies when there is no rbac context", async () => {
    getRbacContext.mockResolvedValue(null);
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(false);
  });

  it("allows holders of hq:video:read", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "owner",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(["hq:video:read"]),
    });
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
    mockState.selectResults = [[{ id: "slot" }]];
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(true);
  });

  it("denies an officer with neither permission nor slot", async () => {
    getRbacContext.mockResolvedValue({
      isPlatformMaintainer: false,
      roleName: "officer",
      currentAllianceId: "alliance-1",
      hqUserId: "u",
      permissions: new Set<string>(),
    });
    mockState.selectResults = [[]];
    await expect(sessionCanReadAllianceVideoQueue("s")).resolves.toBe(false);
  });
});
