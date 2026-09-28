import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionIdMock = vi.fn();
const loadSessionMock = vi.fn();
const getAshedConnectionMock = vi.fn();
const requireAllianceAdminMock = vi.fn();
const syncAshedAllianceRolesMock = vi.fn();
const getAllianceTeamMock = vi.fn();
const resolveSessionAllianceIdMock = vi.fn();
const syncAllianceRosterForSessionMock = vi.fn();

vi.mock("@/lib/session", () => ({
  readSessionId: () => readSessionIdMock(),
  loadSession: (...args: unknown[]) => loadSessionMock(...args),
  getAshedConnection: (...args: unknown[]) => getAshedConnectionMock(...args),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireAllianceAdmin: (...args: unknown[]) =>
    requireAllianceAdminMock(...args),
}));

vi.mock("@/lib/rbac/sync-ashed-roles", () => ({
  syncAshedAllianceRoles: (...args: unknown[]) =>
    syncAshedAllianceRolesMock(...args),
  getAllianceTeam: (...args: unknown[]) => getAllianceTeamMock(...args),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: (...args: unknown[]) =>
    resolveSessionAllianceIdMock(...args),
}));

vi.mock("@/lib/settings/alliance-settings-access.server", () => ({
  resolveAllianceSettingsAccess: vi.fn(),
}));

vi.mock("@/lib/members/roster-sync.server", () => {
  class RosterSyncUnavailableError extends Error {}
  return {
    RosterSyncUnavailableError,
    syncAllianceRosterForSession: (...args: unknown[]) =>
      syncAllianceRosterForSessionMock(...args),
  };
});

import { RosterSyncUnavailableError } from "@/lib/members/roster-sync.server";
import { POST } from "./route";

const SESSION = {
  id: "sess-1",
  hqUserId: "user-1",
  allianceTag: "LFgo",
  currentAllianceId: "alliance-1",
};

describe("POST /api/settings/team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSessionIdMock.mockResolvedValue("sess-1");
    requireAllianceAdminMock.mockResolvedValue(null);
    loadSessionMock.mockResolvedValue(SESSION);
    getAshedConnectionMock.mockResolvedValue({
      appId: "app",
      token: "token",
      originUrl: "https://example.test",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: "ashed-user", email: "owner@example.test" }),
      ),
    );
    syncAshedAllianceRolesMock.mockResolvedValue(undefined);
    resolveSessionAllianceIdMock.mockReturnValue("alliance-1");
    getAllianceTeamMock.mockResolvedValue([{ membershipId: "m-1" }]);
    syncAllianceRosterForSessionMock.mockResolvedValue({ synced: 3 });
  });

  it("syncs the alliance roster after collaborator roles", async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(syncAshedAllianceRolesMock).toHaveBeenCalledTimes(1);
    expect(syncAllianceRosterForSessionMock).toHaveBeenCalledWith({
      sessionId: "sess-1",
      allianceId: "alliance-1",
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      team: [{ membershipId: "m-1" }],
      rosterSynced: true,
    });
  });

  it("still returns the team when roster sync is unavailable", async () => {
    syncAllianceRosterForSessionMock.mockRejectedValue(
      new RosterSyncUnavailableError("none"),
    );

    const res = await POST();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ rosterSynced: false });
  });

  it("does not fail the refresh when roster sync throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncAllianceRosterForSessionMock.mockRejectedValue(new Error("ashed down"));

    const res = await POST();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ rosterSynced: false });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("skips roster sync without alliance context", async () => {
    resolveSessionAllianceIdMock.mockReturnValue(null);

    const res = await POST();

    expect(syncAllianceRosterForSessionMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      ok: true,
      team: [],
      rosterSynced: false,
    });
  });

  it("keeps the alliance admin gate", async () => {
    requireAllianceAdminMock.mockResolvedValue(
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST();

    expect(res.status).toBe(403);
    expect(syncAshedAllianceRolesMock).not.toHaveBeenCalled();
    expect(syncAllianceRosterForSessionMock).not.toHaveBeenCalled();
  });
});
