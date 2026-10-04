import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session } from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  auth: vi.fn(),
  getRbacContext: vi.fn(),
  requirePlatformMaintainer: vi.fn(),
  requireSessionPermission: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: mocks.getRbacContext,
}));
vi.mock("@/lib/rbac/require-permission", () => ({
  requirePlatformMaintainer: mocks.requirePlatformMaintainer,
  requireSessionPermission: mocks.requireSessionPermission,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import {
  ActivityReadError,
  activityAllowedScopes,
  getActivityPrincipalForSession,
  requireActivityPrincipal,
  resolveActivityPageGate,
} from "./access.server";

const SESSION_ID = "session-fixture-1";
const HQ_USER_ID = "hq-user-fixture-1";
const ALLIANCE_ID = "alliance-fixture-1";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    userLabel: null,
    allianceId: "ashed-external-id",
    allianceTag: null,
    hqUserId: HQ_USER_ID,
    currentAllianceId: ALLIANCE_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    ...overrides,
  } as Session;
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    hqUserId: HQ_USER_ID,
    isPlatformMaintainer: false,
    currentAllianceId: ALLIANCE_ID,
    permissions: new Set<string>(),
    alliancePermissions: new Map<string, Set<string>>(),
    ...overrides,
  };
}

const denied = () =>
  NextResponse.json({ error: "Forbidden" }, { status: 403 });

async function expectReadError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ActivityReadError);
    expect((error as ActivityReadError).code).toBe(code);
    expect((error as ActivityReadError).status).toBe(status);
    return;
  }
  throw new Error(`expected ActivityReadError ${code}`);
}

describe("getActivityPrincipalForSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers());
    mocks.auth.mockResolvedValue({ user: { id: HQ_USER_ID } });
    mocks.getRbacContext.mockResolvedValue(makeContext());
  });

  it("returns null when the workspace is not bound to an HQ user", async () => {
    const principal = await getActivityPrincipalForSession(
      makeSession({ hqUserId: null }),
    );
    expect(principal).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const principal = await getActivityPrincipalForSession(
      makeSession({ expiresAt: new Date("2020-01-01T00:00:00Z") }),
    );
    expect(principal).toBeNull();
  });

  it("returns null when the auth identity is missing", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(
      await getActivityPrincipalForSession(makeSession()),
    ).toBeNull();
  });

  it("returns null when the auth identity does not match the workspace", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "other-user" } });
    expect(
      await getActivityPrincipalForSession(makeSession()),
    ).toBeNull();
  });

  it("returns null when the rbac context is missing", async () => {
    mocks.getRbacContext.mockResolvedValue(null);
    expect(
      await getActivityPrincipalForSession(makeSession()),
    ).toBeNull();
  });

  it("returns null when the rbac context binds a different user", async () => {
    mocks.getRbacContext.mockResolvedValue(
      makeContext({ hqUserId: "other-user" }),
    );
    expect(
      await getActivityPrincipalForSession(makeSession()),
    ).toBeNull();
  });

  it("returns null when the canonical alliance changed", async () => {
    mocks.getRbacContext.mockResolvedValue(
      makeContext({ currentAllianceId: "other-alliance" }),
    );
    expect(
      await getActivityPrincipalForSession(makeSession()),
    ).toBeNull();
  });

  it("binds the canonical alliance and computes the fence", async () => {
    const principal = await getActivityPrincipalForSession(makeSession());
    expect(principal).not.toBeNull();
    expect(principal!.hqUserId).toBe(HQ_USER_ID);
    expect(principal!.sessionId).toBe(SESSION_ID);
    expect(principal!.currentAllianceId).toBe(ALLIANCE_ID);
    expect(principal!.scopeFence).toBe(
      JSON.stringify([HQ_USER_ID, ALLIANCE_ID]),
    );
  });

  it("requires hq:admin for the maintainer flag", async () => {
    mocks.getRbacContext.mockResolvedValue(
      makeContext({
        isPlatformMaintainer: true,
        permissions: new Set(["hq:audit:read"]),
      }),
    );
    const principal = await getActivityPrincipalForSession(makeSession());
    expect(principal!.isPlatformMaintainer).toBe(false);

    mocks.getRbacContext.mockResolvedValue(
      makeContext({
        isPlatformMaintainer: true,
        permissions: new Set(["hq:admin"]),
      }),
    );
    const maintainer = await getActivityPrincipalForSession(makeSession());
    expect(maintainer!.isPlatformMaintainer).toBe(true);
  });
});

describe("activityAllowedScopes", () => {
  const base = {
    hqUserId: HQ_USER_ID,
    sessionId: SESSION_ID,
    currentAllianceId: ALLIANCE_ID,
    permissions: new Set<string>(),
    isPlatformMaintainer: false,
    scopeFence: JSON.stringify([HQ_USER_ID, ALLIANCE_ID]),
  };

  it("always allows personal", () => {
    expect(activityAllowedScopes({ ...base, currentAllianceId: null })).toEqual(
      ["personal"],
    );
  });

  it("allows alliance for audit readers with a selected alliance", () => {
    expect(
      activityAllowedScopes({
        ...base,
        permissions: new Set(["hq:audit:read"]),
      }),
    ).toEqual(["personal", "alliance"]);
  });

  it("denies alliance scope without a selected alliance", () => {
    expect(
      activityAllowedScopes({
        ...base,
        currentAllianceId: null,
        permissions: new Set(["hq:audit:read"]),
        isPlatformMaintainer: true,
      }),
    ).toEqual(["personal", "global"]);
  });

  it("allows every scope for a maintainer with a selected alliance", () => {
    expect(
      activityAllowedScopes({ ...base, isPlatformMaintainer: true }),
    ).toEqual(["personal", "alliance", "global"]);
  });
});

describe("resolveActivityPageGate", () => {
  const base = {
    hqUserId: HQ_USER_ID,
    sessionId: SESSION_ID,
    currentAllianceId: ALLIANCE_ID,
    permissions: new Set<string>(),
    isPlatformMaintainer: false,
    scopeFence: JSON.stringify([HQ_USER_ID, ALLIANCE_ID]),
  };

  it("renders the personal feed for every signed-in principal", () => {
    expect(resolveActivityPageGate(base, "personal")).toEqual({
      type: "feed",
      allowedScopes: ["personal"],
    });
  });

  it("does not offer the alliance prompt to a member with no selected alliance", () => {
    expect(
      resolveActivityPageGate(
        { ...base, currentAllianceId: null },
        "alliance",
      ),
    ).toEqual({ type: "not-found" });
    expect(
      resolveActivityPageGate({ ...base, currentAllianceId: null }, "global"),
    ).toEqual({ type: "not-found" });
  });

  it("prompts audit readers to select an alliance before the alliance feed", () => {
    expect(
      resolveActivityPageGate(
        {
          ...base,
          currentAllianceId: null,
          permissions: new Set(["hq:audit:read"]),
        },
        "alliance",
      ),
    ).toEqual({ type: "select-alliance" });
  });

  it("hides alliance and global feeds the principal cannot read", () => {
    expect(resolveActivityPageGate(base, "alliance")).toEqual({
      type: "not-found",
    });
    expect(resolveActivityPageGate(base, "global")).toEqual({
      type: "not-found",
    });
  });

  it("renders alliance for an audit reader and global for a maintainer", () => {
    expect(
      resolveActivityPageGate(
        { ...base, permissions: new Set(["hq:audit:read"]) },
        "alliance",
      ),
    ).toMatchObject({ type: "feed", allowedScopes: ["personal", "alliance"] });
    expect(
      resolveActivityPageGate(
        { ...base, currentAllianceId: null, isPlatformMaintainer: true },
        "global",
      ),
    ).toMatchObject({ type: "feed", allowedScopes: ["personal", "global"] });
  });
});

describe("requireActivityPrincipal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers());
    mocks.auth.mockResolvedValue({ user: { id: HQ_USER_ID } });
    mocks.getRbacContext.mockResolvedValue(makeContext());
    mocks.requireApiSession.mockResolvedValue(makeSession());
    mocks.requirePlatformMaintainer.mockResolvedValue(null);
    mocks.requireSessionPermission.mockResolvedValue(null);
  });

  it("throws unauthorized when no session exists", async () => {
    mocks.requireApiSession.mockResolvedValue(denied());
    await expectReadError(
      requireActivityPrincipal("personal"),
      "unauthorized",
      401,
    );
  });

  it("throws forbidden for a bootstrap workspace without identity", async () => {
    mocks.requireApiSession.mockResolvedValue(makeSession({ hqUserId: null }));
    await expectReadError(requireActivityPrincipal("personal"), "forbidden", 403);
    await expectReadError(requireActivityPrincipal("alliance"), "forbidden", 403);
    await expectReadError(requireActivityPrincipal("global"), "forbidden", 403);
  });

  it("denies alliance to a plain member", async () => {
    mocks.requireSessionPermission.mockResolvedValue(denied());
    await expectReadError(requireActivityPrincipal("alliance"), "forbidden", 403);
    await expect(
      requireActivityPrincipal("personal"),
    ).resolves.toMatchObject({ hqUserId: HQ_USER_ID });
  });

  it("allows alliance to an officer but never global", async () => {
    mocks.getRbacContext.mockResolvedValue(
      makeContext({ permissions: new Set(["hq:audit:read"]) }),
    );
    mocks.requirePlatformMaintainer.mockResolvedValue(denied());
    await expect(
      requireActivityPrincipal("alliance"),
    ).resolves.toMatchObject({ currentAllianceId: ALLIANCE_ID });
    await expectReadError(requireActivityPrincipal("global"), "forbidden", 403);
  });

  it("allows every scope to a maintainer", async () => {
    mocks.getRbacContext.mockResolvedValue(
      makeContext({
        isPlatformMaintainer: true,
        permissions: new Set(["hq:admin"]),
      }),
    );
    await expect(requireActivityPrincipal("personal")).resolves.toBeTruthy();
    await expect(requireActivityPrincipal("alliance")).resolves.toBeTruthy();
    await expect(requireActivityPrincipal("global")).resolves.toBeTruthy();
  });

  it("allows personal without a selected alliance but not alliance", async () => {
    mocks.requireApiSession.mockResolvedValue(
      makeSession({ currentAllianceId: null }),
    );
    mocks.getRbacContext.mockResolvedValue(
      makeContext({
        currentAllianceId: null,
        permissions: new Set(["hq:audit:read"]),
      }),
    );
    mocks.requireSessionPermission.mockResolvedValue(null);
    await expect(
      requireActivityPrincipal("personal"),
    ).resolves.toMatchObject({ currentAllianceId: null });
    await expectReadError(requireActivityPrincipal("alliance"), "forbidden", 403);
  });

  it("rejects a mismatched scope fence header", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({ "x-activity-scope": JSON.stringify(["other", null]) }),
    );
    await expectReadError(requireActivityPrincipal("personal"), "forbidden", 403);
  });

  it("accepts a matching scope fence header", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        "x-activity-scope": JSON.stringify([HQ_USER_ID, ALLIANCE_ID]),
      }),
    );
    await expect(
      requireActivityPrincipal("personal"),
    ).resolves.toMatchObject({ hqUserId: HQ_USER_ID });
  });
});
