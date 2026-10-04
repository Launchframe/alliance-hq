import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireApiSession = vi.fn();
const mockRequireSessionPermission = vi.fn();
const mockGetActivityPrincipalForSession = vi.fn();
const mockHandleWebKillsCommand = vi.fn();

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

vi.mock("@/lib/kills/web-kills.server", () => ({
  handleWebKillsCommand: (...args: unknown[]) =>
    mockHandleWebKillsCommand(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: () => Promise.resolve("en-US"),
  getTranslations: () => Promise.resolve((key: string) => key),
}));

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
  permissions: new Set(["members:read"]),
  isPlatformMaintainer: false,
  scopeFence: "",
};

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/kills/me/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kills/me/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiSession.mockResolvedValue(SESSION);
    mockRequireSessionPermission.mockResolvedValue(null);
    mockGetActivityPrincipalForSession.mockResolvedValue(PRINCIPAL);
    mockHandleWebKillsCommand.mockResolvedValue({
      status: "set_kills",
      message: "ok",
      newKills: 125_000,
    });
  });

  it("rejects anonymous requests", async () => {
    mockRequireApiSession.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(jsonRequest({ total: 125_000 }));

    expect(res.status).toBe(401);
    expect(mockHandleWebKillsCommand).not.toHaveBeenCalled();
  });

  it("rejects sessions without a verified activity principal", async () => {
    mockGetActivityPrincipalForSession.mockResolvedValue(null);

    const res = await POST(jsonRequest({ total: 125_000 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "accessChanged" });
    expect(mockHandleWebKillsCommand).not.toHaveBeenCalled();
  });

  it("rejects a principal bound to another alliance", async () => {
    mockGetActivityPrincipalForSession.mockResolvedValue({
      ...PRINCIPAL,
      currentAllianceId: "other-alliance",
    });

    const res = await POST(jsonRequest({ total: 125_000 }));

    expect(res.status).toBe(403);
    expect(mockHandleWebKillsCommand).not.toHaveBeenCalled();
  });

  it("passes the verified principal on JSON submissions", async () => {
    const res = await POST(jsonRequest({ total: 125_000 }));

    expect(res.status).toBe(200);
    expect(mockHandleWebKillsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "ally-1",
        hqUserId: "hq-1",
        principal: PRINCIPAL,
        total: 125_000,
      }),
    );
  });

  it("passes the verified principal on multipart submissions", async () => {
    const form = new FormData();
    form.set("confirm", "yes");

    const res = await POST(
      new Request("http://localhost/api/kills/me/submit", {
        method: "POST",
        body: form,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockHandleWebKillsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: PRINCIPAL,
        confirm: "yes",
        screenshotBuffer: null,
      }),
    );
  });
});
