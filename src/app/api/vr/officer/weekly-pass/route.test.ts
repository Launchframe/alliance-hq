import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireApiSession = vi.fn();
const mockRequireSessionPermission = vi.fn();
const mockGetActivityPrincipalForSession = vi.fn();
const mockGetCommanderByAshedMemberId = vi.fn();
const mockSetWeeklyPass = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: (...args: unknown[]) => mockRequireApiSession(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: (...args: unknown[]) =>
    mockRequireSessionPermission(...args),
}));

vi.mock("@/lib/activity/access.server", () => ({
  getActivityPrincipalForSession: (...args: unknown[]) =>
    mockGetActivityPrincipalForSession(...args),
}));

vi.mock("@/lib/vr/repository", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/vr/repository")>();
  return {
    ...original,
    getCommanderByAshedMemberId: (...args: unknown[]) =>
      mockGetCommanderByAshedMemberId(...args),
    setWeeklyPass: (...args: unknown[]) => mockSetWeeklyPass(...args),
  };
});

vi.mock("next-intl/server", () => ({
  getLocale: () => Promise.resolve("en-US"),
  getTranslations: () => Promise.resolve((key: string) => key),
}));

import { ActivityWriteError } from "@/lib/activity/errors.server";
import { WeeklyPassTargetChangedError } from "@/lib/vr/repository";

import { POST } from "./route";

const SESSION = {
  id: "sess-1",
  hqUserId: "hq-1",
  currentAllianceId: "ally-1",
  allianceId: "ally-1",
  expiresAt: new Date(Date.now() + 60_000),
};

const PRINCIPAL = {
  hqUserId: "hq-1",
  sessionId: "sess-1",
  currentAllianceId: "ally-1",
  permissions: new Set(["members:write"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/vr/officer/weekly-pass", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/vr/officer/weekly-pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiSession.mockResolvedValue(SESSION);
    mockRequireSessionPermission.mockResolvedValue(null);
    mockGetActivityPrincipalForSession.mockResolvedValue(PRINCIPAL);
    mockGetCommanderByAshedMemberId.mockResolvedValue({
      commanderId: "cmd-1",
      weeklyPassActive: false,
    });
    mockSetWeeklyPass.mockResolvedValue(true);
  });

  it("rejects anonymous requests", async () => {
    mockRequireApiSession.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(401);
    expect(mockSetWeeklyPass).not.toHaveBeenCalled();
  });

  it("rejects underprivileged sessions before any write", async () => {
    mockRequireSessionPermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(403);
    expect(mockRequireSessionPermission).toHaveBeenCalledWith(
      "sess-1",
      "members:write",
    );
    expect(mockSetWeeklyPass).not.toHaveBeenCalled();
  });

  it("rejects sessions without a verified activity principal", async () => {
    mockGetActivityPrincipalForSession.mockResolvedValue(null);

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "accessChanged" });
    expect(mockSetWeeklyPass).not.toHaveBeenCalled();
    expect(mockGetCommanderByAshedMemberId).not.toHaveBeenCalled();
  });

  it("rejects a principal bound to another alliance", async () => {
    mockGetActivityPrincipalForSession.mockResolvedValue({
      ...PRINCIPAL,
      currentAllianceId: "other-alliance",
    });

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(403);
    expect(mockSetWeeklyPass).not.toHaveBeenCalled();
    expect(mockGetCommanderByAshedMemberId).not.toHaveBeenCalled();
  });

  it("rejects when the target member has no commander in this alliance", async () => {
    mockGetCommanderByAshedMemberId.mockResolvedValue(null);

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(404);
    expect(mockSetWeeklyPass).not.toHaveBeenCalled();
  });

  it("passes the officer principal and target member to the writer", async () => {
    const res = await POST(
      jsonRequest({ ashedMemberId: "member-1", active: true }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSetWeeklyPass).toHaveBeenCalledWith({
      commanderId: "cmd-1",
      allianceId: "ally-1",
      ashedMemberId: "member-1",
      active: true,
      source: "officer",
      activity: { identity: { kind: "web", principal: PRINCIPAL } },
    });
  });

  it("maps activity write failures to a localized 503", async () => {
    mockSetWeeklyPass.mockRejectedValue(
      new ActivityWriteError({
        eventKey: "member.weekly_pass_updated",
        failureCategory: "unknown",
      }),
    );

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "saveBlocked" });
  });

  it("maps a moved target to a localized 404", async () => {
    mockSetWeeklyPass.mockRejectedValue(new WeeklyPassTargetChangedError());

    const res = await POST(jsonRequest({ ashedMemberId: "member-1", active: true }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "commanderNotFound" });
  });

  it("rethrows unrelated writer failures", async () => {
    mockSetWeeklyPass.mockRejectedValue(new Error("db down"));

    await expect(
      POST(jsonRequest({ ashedMemberId: "member-1", active: true })),
    ).rejects.toThrow("db down");
  });
});
