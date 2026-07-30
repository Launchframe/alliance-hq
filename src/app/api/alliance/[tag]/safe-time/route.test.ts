import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const resolveAllianceRouteForSessionMock = vi.fn();
const requireAllianceRoutePermissionMock = vi.fn();
const sessionHasPermissionForAllianceMock = vi.fn();
const loadAllianceSafeTimeSettingsMock = vi.fn();
const saveAllianceSafeTimeSlotMock = vi.fn();
const writeAuditLogMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
}));

vi.mock("@/lib/alliance/alliance-route-context.server", () => ({
  allianceRouteErrorResponse: (error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 }),
  requireAllianceRoutePermission: (
    sessionId: string,
    allianceId: string,
    permission: string,
  ) => requireAllianceRoutePermissionMock(sessionId, allianceId, permission),
  resolveAllianceRouteForSession: (sessionId: string, tag: string) =>
    resolveAllianceRouteForSessionMock(sessionId, tag),
}));

vi.mock("@/lib/rbac/context", () => ({
  sessionHasPermissionForAlliance: (
    sessionId: string,
    allianceId: string,
    permission: string,
  ) =>
    sessionHasPermissionForAllianceMock(sessionId, allianceId, permission),
}));

vi.mock("@/lib/alliance/alliance-safe-time.server", () => ({
  loadAllianceSafeTimeSettings: (allianceId: string, canManage: boolean) =>
    loadAllianceSafeTimeSettingsMock(allianceId, canManage),
  saveAllianceSafeTimeSlot: (
    allianceId: string,
    slot: string,
  ) => saveAllianceSafeTimeSlotMock(allianceId, slot),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (input: unknown) => writeAuditLogMock(input),
}));

import { GET, PATCH } from "./route";

const alliance = {
  allianceId: "ally-1",
  tag: "LFgo",
  name: "Launchframe",
};

const settings = {
  allianceSafeTimeSlot: "12" as const,
  canManage: true,
};

function patchSafeTime(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/alliance/lfgo/safe-time", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tag: "lfgo" }) },
  );
}

describe("/api/alliance/[tag]/safe-time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue({
      id: "session-1",
      hqUserId: "user-1",
    });
    resolveAllianceRouteForSessionMock.mockResolvedValue(alliance);
    requireAllianceRoutePermissionMock.mockResolvedValue(null);
    sessionHasPermissionForAllianceMock.mockResolvedValue(true);
    loadAllianceSafeTimeSettingsMock.mockResolvedValue(settings);
    saveAllianceSafeTimeSlotMock.mockResolvedValue({
      allianceSafeTimeSlot: "20",
    });
  });

  it("GET requires scores:read for the resolved alliance", async () => {
    await GET(new Request("http://localhost"), {
      params: Promise.resolve({ tag: "lfgo" }),
    });

    expect(requireAllianceRoutePermissionMock).toHaveBeenCalledWith(
      "session-1",
      "ally-1",
      "scores:read",
    );
  });

  it("PATCH requires alliance:admin", async () => {
    await patchSafeTime({ allianceSafeTimeSlot: "20" });

    expect(requireAllianceRoutePermissionMock).toHaveBeenCalledWith(
      "session-1",
      "ally-1",
      "alliance:admin",
    );
  });

  it("PATCH returns 403 when alliance:admin is denied", async () => {
    const forbidden = Response.json({ error: "Forbidden" }, { status: 403 });
    requireAllianceRoutePermissionMock.mockResolvedValue(forbidden);

    const response = await patchSafeTime({ allianceSafeTimeSlot: "20" });

    expect(response.status).toBe(403);
    expect(saveAllianceSafeTimeSlotMock).not.toHaveBeenCalled();
  });

  it("PATCH audits when the slot changes", async () => {
    loadAllianceSafeTimeSettingsMock.mockResolvedValueOnce({
      allianceSafeTimeSlot: "12",
      canManage: true,
    });

    await patchSafeTime({ allianceSafeTimeSlot: "20" });

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "alliance.safe_time_update",
        allianceId: "ally-1",
      }),
    );
  });

  it("PATCH rejects invalid slot payloads", async () => {
    const response = await patchSafeTime({ allianceSafeTimeSlot: "99" });

    expect(response.status).toBe(400);
    expect(saveAllianceSafeTimeSlotMock).not.toHaveBeenCalled();
  });
});
