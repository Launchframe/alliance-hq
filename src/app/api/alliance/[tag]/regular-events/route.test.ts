import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveAllianceRouteForSessionMock = vi.fn();
const requireAllianceRoutePermissionMock = vi.fn();
const sessionHasPermissionForAllianceMock = vi.fn();
const loadRegularEventsSettingsMock = vi.fn();
const saveRegularEventsSettingsMock = vi.fn();
const writeAuditLogMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: () => requireApiSessionMock(),
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

vi.mock("@/lib/regular-events/settings.server", () => ({
  loadRegularEventsSettings: (allianceId: string, canManage: boolean) =>
    loadRegularEventsSettingsMock(allianceId, canManage),
  saveRegularEventsSettings: (
    allianceId: string,
    input: unknown,
    canManage: boolean,
  ) => saveRegularEventsSettingsMock(allianceId, input, canManage),
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
  announcementsEnabled: false,
  canyonStormActive: false,
  guildChannelCount: 0,
  guilds: [],
  rules: [],
  canManage: false,
};

function getRegularEvents() {
  return GET(new Request("http://localhost/api/alliance/lfgo/regular-events"), {
    params: Promise.resolve({ tag: "lfgo" }),
  });
}

function patchRegularEvents(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/alliance/lfgo/regular-events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tag: "lfgo" }) },
  );
}

describe("/api/alliance/[tag]/regular-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      id: "sess-1",
      hqUserId: "hq-1",
    });
    resolveAllianceRouteForSessionMock.mockResolvedValue(alliance);
    requireAllianceRoutePermissionMock.mockResolvedValue(null);
    sessionHasPermissionForAllianceMock.mockResolvedValue(false);
    loadRegularEventsSettingsMock.mockResolvedValue(settings);
    saveRegularEventsSettingsMock.mockResolvedValue({
      ...settings,
      announcementsEnabled: true,
      canManage: true,
    });
    writeAuditLogMock.mockResolvedValue(undefined);
  });

  it("GET requires scores:read and returns canManage from trains:write", async () => {
    sessionHasPermissionForAllianceMock.mockImplementation(
      (_sessionId, _allianceId, permission) =>
        Promise.resolve(permission === "trains:write"),
    );
    loadRegularEventsSettingsMock.mockResolvedValue({
      ...settings,
      canManage: true,
    });

    const res = await getRegularEvents();

    expect(res.status).toBe(200);
    expect(requireAllianceRoutePermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "ally-1",
      "scores:read",
    );
    expect(sessionHasPermissionForAllianceMock).toHaveBeenCalledWith(
      "sess-1",
      "ally-1",
      "trains:write",
    );
    expect(loadRegularEventsSettingsMock).toHaveBeenCalledWith("ally-1", true);
    const body = (await res.json()) as { canManage: boolean; allianceTag: string };
    expect(body.canManage).toBe(true);
    expect(body.allianceTag).toBe("LFgo");
  });

  it("PATCH requires trains:write", async () => {
    const forbidden = Response.json({ error: "Forbidden" }, { status: 403 });
    requireAllianceRoutePermissionMock.mockResolvedValue(forbidden);

    const res = await patchRegularEvents({ announcementsEnabled: true });

    expect(res.status).toBe(403);
    expect(requireAllianceRoutePermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "ally-1",
      "trains:write",
    );
    expect(saveRegularEventsSettingsMock).not.toHaveBeenCalled();
  });

  it("PATCH writes audit log when settings save succeeds", async () => {
    sessionHasPermissionForAllianceMock.mockResolvedValue(true);
    loadRegularEventsSettingsMock.mockResolvedValue({
      ...settings,
      canManage: true,
    });

    const res = await patchRegularEvents({ canyonStormActive: true });

    expect(res.status).toBe(200);
    expect(saveRegularEventsSettingsMock).toHaveBeenCalledWith(
      "ally-1",
      { canyonStormActive: true },
      true,
    );
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "regular_events.settings_update",
        allianceId: "ally-1",
      }),
    );
  });

  it("PATCH 400s on empty body", async () => {
    sessionHasPermissionForAllianceMock.mockResolvedValue(true);

    const res = await patchRegularEvents({});

    expect(res.status).toBe(400);
    expect(saveRegularEventsSettingsMock).not.toHaveBeenCalled();
  });
});
