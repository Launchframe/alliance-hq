import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

import {
  legacyAllowAllDataManagementRbac,
  resolveDataManagementApiContext,
  resolveDataManagementRbac,
} from "./api-context.server";

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: vi.fn(),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getOrCreateSession: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: vi.fn(),
}));

import { getRbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession, loadSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";

const mockedGetRbacContext = vi.mocked(getRbacContext);
const mockedRequireSessionPermission = vi.mocked(requireSessionPermission);
const mockedGetOrCreateSession = vi.mocked(getOrCreateSession);
const mockedLoadSession = vi.mocked(loadSession);
const mockedResolveSessionAllianceId = vi.mocked(resolveSessionAllianceId);

describe("resolveDataManagementRbac", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rbac context when session is linked to an HQ user", async () => {
    const rbac = {
      sessionId: "sess-1",
      hqUserId: "hq-1",
      roleName: "officer",
      permissions: new Set(["data:read"]),
    };
    mockedGetRbacContext.mockResolvedValue(rbac as never);

    await expect(
      resolveDataManagementRbac("sess-1", "alliance-1"),
    ).resolves.toBe(rbac);
  });

  it("returns owner-level legacy rbac when hq_user_id is missing", async () => {
    mockedGetRbacContext.mockResolvedValue(null);
    mockedLoadSession.mockResolvedValue({
      id: "sess-legacy",
      hqUserId: null,
    } as never);

    const rbac = await resolveDataManagementRbac("sess-legacy", "alliance-1");
    expect(rbac).toEqual(
      legacyAllowAllDataManagementRbac("sess-legacy", "alliance-1"),
    );
    expect(rbac?.roleName).toBe("owner");
  });
});

describe("resolveDataManagementApiContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when alliance context is missing", async () => {
    mockedGetOrCreateSession.mockResolvedValue({ id: "sess-1" } as never);
    mockedResolveSessionAllianceId.mockReturnValue(null);

    const result = await resolveDataManagementApiContext();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
  });

  it("delegates read permission to requireSessionPermission", async () => {
    mockedGetOrCreateSession.mockResolvedValue({
      id: "sess-1",
      hqUserId: "hq-1",
    } as never);
    mockedResolveSessionAllianceId.mockReturnValue("alliance-1");
    mockedRequireSessionPermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const result = await resolveDataManagementApiContext();
    expect(mockedRequireSessionPermission).toHaveBeenCalledWith(
      "sess-1",
      "data:read",
    );
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns legacy audit hq user id as null", async () => {
    mockedGetOrCreateSession.mockResolvedValue({
      id: "sess-legacy",
      hqUserId: null,
    } as never);
    mockedResolveSessionAllianceId.mockReturnValue("alliance-1");
    mockedRequireSessionPermission.mockResolvedValue(null);
    mockedGetRbacContext.mockResolvedValue(null);
    mockedLoadSession.mockResolvedValue({
      id: "sess-legacy",
      hqUserId: null,
    } as never);

    const result = await resolveDataManagementApiContext();
    expect(result).toMatchObject({
      sessionId: "sess-legacy",
      allianceId: "alliance-1",
      auditHqUserId: null,
    });
  });
});
