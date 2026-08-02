import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

import {
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
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: vi.fn(),
}));

import { getRbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";

const mockedGetRbacContext = vi.mocked(getRbacContext);
const mockedRequireSessionPermission = vi.mocked(requireSessionPermission);
const mockedGetOrCreateSession = vi.mocked(requireApiSession);
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

    await expect(resolveDataManagementRbac("sess-1")).resolves.toBe(rbac);
  });

  it("denies (returns null) when hq_user_id is missing — no legacy owner fallback", async () => {
    mockedGetRbacContext.mockResolvedValue(null);

    const rbac = await resolveDataManagementRbac("sess-legacy");
    expect(rbac).toBeNull();
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

  it("denies with 401 for a hq_user_id-less session even if the permission gate is bypassed", async () => {
    // Defense in depth: resolveDataManagementRbac must independently deny
    // hqUserId-less sessions rather than trust requireSessionPermission alone.
    mockedGetOrCreateSession.mockResolvedValue({
      id: "sess-legacy",
      hqUserId: null,
    } as never);
    mockedResolveSessionAllianceId.mockReturnValue("alliance-1");
    mockedRequireSessionPermission.mockResolvedValue(null);
    mockedGetRbacContext.mockResolvedValue(null);

    const result = await resolveDataManagementApiContext();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });
});
