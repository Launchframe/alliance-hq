import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const resolveAllianceRouteForSessionMock = vi.fn();
const requireAllianceRoutePermissionMock = vi.fn();
const getRbacContextMock = vi.fn();
const getAllianceMembershipRbacMock = vi.fn();
const loadTrainDiscordSettingsMock = vi.fn();
const saveTrainDiscordSettingsMock = vi.fn();
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
  getAllianceMembershipRbac: (
    sessionId: string,
    hqUserId: string,
    allianceId: string,
  ) => getAllianceMembershipRbacMock(sessionId, hqUserId, allianceId),
  getRbacContext: (sessionId: string) => getRbacContextMock(sessionId),
  sessionHasPermissionForAlliance: vi.fn(),
}));

vi.mock("@/lib/trains/train-discord-settings.server", () => ({
  loadTrainDiscordSettings: (
    allianceId: string,
    canManage: boolean,
    canConfigureChannelSetterMinRank: boolean,
  ) =>
    loadTrainDiscordSettingsMock(
      allianceId,
      canManage,
      canConfigureChannelSetterMinRank,
    ),
  saveTrainDiscordSettings: (
    allianceId: string,
    input: unknown,
    canConfigureChannelSetterMinRank: boolean,
  ) =>
    saveTrainDiscordSettingsMock(
      allianceId,
      input,
      canConfigureChannelSetterMinRank,
    ),
}));

vi.mock("@/lib/bff/audit", () => ({
  writeAuditLog: (input: unknown) => writeAuditLogMock(input),
}));

import { PATCH } from "./route";

const alliance = {
  allianceId: "ally-1",
  tag: "LFgo",
  name: "Launchframe",
};

const settings = {
  announcementsEnabled: true,
  channelSetterMinRank: "officer" as const,
  guildChannelCount: 0,
  guilds: [],
  canManage: true,
  canConfigureChannelSetterMinRank: false,
};

function patchTrainDiscord(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/alliance/lfgo/train-discord", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tag: "lfgo" }) },
  );
}

describe("PATCH /api/alliance/[tag]/train-discord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-1",
      hqUserId: "hq-1",
    });
    resolveAllianceRouteForSessionMock.mockResolvedValue(alliance);
    requireAllianceRoutePermissionMock.mockResolvedValue(null);
    getRbacContextMock.mockResolvedValue({ hqUserId: "hq-1" });
    getAllianceMembershipRbacMock.mockResolvedValue({ roleName: "officer" });
    loadTrainDiscordSettingsMock.mockResolvedValue(settings);
    saveTrainDiscordSettingsMock.mockResolvedValue(settings);
    writeAuditLogMock.mockResolvedValue(undefined);
  });

  it("403s when a non-owner patches channelSetterMinRank", async () => {
    requireAllianceRoutePermissionMock.mockResolvedValue(null);
    getAllianceMembershipRbacMock.mockResolvedValue({ roleName: "officer" });

    const res = await patchTrainDiscord({ channelSetterMinRank: "owner" });

    expect(res.status).toBe(403);
    expect(requireAllianceRoutePermissionMock).not.toHaveBeenCalled();
    expect(saveTrainDiscordSettingsMock).not.toHaveBeenCalled();
  });

  it("allows an owner to patch channelSetterMinRank without trains:write", async () => {
    requireAllianceRoutePermissionMock.mockResolvedValue(
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );
    getAllianceMembershipRbacMock.mockResolvedValue({ roleName: "owner" });
    saveTrainDiscordSettingsMock.mockResolvedValue({
      ...settings,
      channelSetterMinRank: "owner",
      canConfigureChannelSetterMinRank: true,
    });

    const res = await patchTrainDiscord({ channelSetterMinRank: "owner" });

    expect(res.status).toBe(200);
    expect(requireAllianceRoutePermissionMock).not.toHaveBeenCalled();
    expect(saveTrainDiscordSettingsMock).toHaveBeenCalledWith(
      "ally-1",
      { announcementsEnabled: undefined, channelSetterMinRank: "owner" },
      true,
    );
  });

  it("requires trains:write when announcementsEnabled is patched", async () => {
    const forbidden = Response.json({ error: "Forbidden" }, { status: 403 });
    requireAllianceRoutePermissionMock.mockResolvedValue(forbidden);

    const res = await patchTrainDiscord({ announcementsEnabled: false });

    expect(res.status).toBe(403);
    expect(requireAllianceRoutePermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "ally-1",
      "trains:write",
    );
    expect(saveTrainDiscordSettingsMock).not.toHaveBeenCalled();
  });
});
