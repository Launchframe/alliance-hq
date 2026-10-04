import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveRosterSyncCapability = vi.fn();
const resolveOfficerAshedAllianceId = vi.fn();
const assertOfficerAshedSessionForSync = vi.fn();
const resolveHqAllianceId = vi.fn();
const syncAllianceMembersFromAshed = vi.fn();
const listActiveAllianceMembersForPool = vi.fn();
const getAllianceRosterLastSyncedAt = vi.fn();
const getAllianceById = vi.fn();
const resolveAllianceAshedBotConnection = vi.fn();

vi.mock("@/lib/members/roster-sync-capability.server", () => ({
  resolveRosterSyncCapability: (...args: unknown[]) =>
    resolveRosterSyncCapability(...args),
  resolveOfficerAshedAllianceId: (...args: unknown[]) =>
    resolveOfficerAshedAllianceId(...args),
  assertOfficerAshedSessionForSync: (...args: unknown[]) =>
    assertOfficerAshedSessionForSync(...args),
}));

vi.mock("@/lib/members/roster.server", () => ({
  resolveHqAllianceId: (...args: unknown[]) => resolveHqAllianceId(...args),
  syncAllianceMembersFromAshed: (...args: unknown[]) =>
    syncAllianceMembersFromAshed(...args),
  listActiveAllianceMembersForPool: (...args: unknown[]) =>
    listActiveAllianceMembersForPool(...args),
  getAllianceRosterLastSyncedAt: (...args: unknown[]) =>
    getAllianceRosterLastSyncedAt(...args),
}));

vi.mock("@/lib/vr/repository", () => ({
  getAllianceById: (...args: unknown[]) => getAllianceById(...args),
}));

vi.mock("@/lib/vr/member-roster", () => ({
  resolveAllianceAshedBotConnection: (...args: unknown[]) =>
    resolveAllianceAshedBotConnection(...args),
}));

vi.mock("@/lib/ashed/credential-share.server", () => ({
  resolveAshedConnectionForAlliance: vi.fn().mockResolvedValue(null),
  requireActiveShareCapability: vi.fn(),
}));

import {
  RosterSyncUnavailableError,
  syncAllianceRosterForSession,
} from "@/lib/members/roster-sync.server";

describe("syncAllianceRosterForSession", () => {
  const syncedAt = new Date("2026-07-25T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    listActiveAllianceMembersForPool.mockResolvedValue([{ id: "m1" }]);
    getAllianceRosterLastSyncedAt.mockResolvedValue(syncedAt);
  });

  it("throws when no sync capability is available", async () => {
    resolveRosterSyncCapability.mockResolvedValue({ kind: "none" });

    await expect(
      syncAllianceRosterForSession({
        sessionId: "sess-1",
        allianceId: "hq-1",
      }),
    ).rejects.toBeInstanceOf(RosterSyncUnavailableError);
  });

  it("recounts members for native_reload without calling Ashed sync", async () => {
    resolveRosterSyncCapability.mockResolvedValue({ kind: "native_reload" });

    const result = await syncAllianceRosterForSession({
      sessionId: "sess-1",
      allianceId: "hq-1",
    });

    expect(syncAllianceMembersFromAshed).not.toHaveBeenCalled();
    expect(result).toEqual({
      synced: 0,
      activeMemberCount: 1,
      lastSyncedAt: syncedAt.toISOString(),
      capability: "native_reload",
    });
  });

  it("syncs via officer Ashed session and returns refreshed counts", async () => {
    resolveRosterSyncCapability.mockResolvedValue({ kind: "officer_ashed" });
    assertOfficerAshedSessionForSync.mockResolvedValue({ token: "tok" });
    getAllianceById.mockResolvedValue({ ashedAllianceId: "ashed-1" });
    resolveHqAllianceId.mockResolvedValue("hq-1");
    syncAllianceMembersFromAshed.mockResolvedValue({ synced: 5 });
    listActiveAllianceMembersForPool.mockResolvedValue([
      { id: "m1" },
      { id: "m2" },
    ]);

    const result = await syncAllianceRosterForSession({
      sessionId: "sess-1",
      allianceId: "hq-1",
    });

    expect(resolveOfficerAshedAllianceId).not.toHaveBeenCalled();
    expect(syncAllianceMembersFromAshed).toHaveBeenCalledWith({
      hqAllianceId: "hq-1",
      ashedAllianceId: "ashed-1",
      connection: { token: "tok" },
    });
    expect(result.synced).toBe(5);
    expect(result.activeMemberCount).toBe(2);
    expect(result.capability).toBe("officer_ashed");
  });

  it("falls back to alliance bot credentials when officer sync returns zero", async () => {
    resolveRosterSyncCapability.mockResolvedValue({ kind: "officer_ashed" });
    assertOfficerAshedSessionForSync.mockResolvedValue({ token: "tok" });
    getAllianceById.mockResolvedValue({ ashedAllianceId: "ashed-1" });
    resolveHqAllianceId.mockResolvedValue("hq-1");
    syncAllianceMembersFromAshed
      .mockResolvedValueOnce({ synced: 0 })
      .mockResolvedValueOnce({ synced: 4 });
    resolveAllianceAshedBotConnection.mockResolvedValue({ token: "bot" });

    const result = await syncAllianceRosterForSession({
      sessionId: "sess-1",
      allianceId: "hq-1",
    });

    expect(syncAllianceMembersFromAshed).toHaveBeenCalledTimes(2);
    expect(syncAllianceMembersFromAshed).toHaveBeenLastCalledWith({
      hqAllianceId: "hq-1",
      ashedAllianceId: "ashed-1",
      connection: { token: "bot" },
    });
    expect(result.synced).toBe(4);
    expect(result.capability).toBe("alliance_ashed");
  });

  it("resolves officer Ashed alliance from session tag when HQ row is unlinked", async () => {
    resolveRosterSyncCapability.mockResolvedValue({ kind: "officer_ashed" });
    assertOfficerAshedSessionForSync.mockResolvedValue({ token: "tok" });
    getAllianceById.mockResolvedValue({ ashedAllianceId: null });
    resolveOfficerAshedAllianceId.mockResolvedValue({
      ashedAllianceId: "ashed-from-tag",
    });
    resolveHqAllianceId.mockResolvedValue("hq-1");
    syncAllianceMembersFromAshed.mockResolvedValue({ synced: 2 });

    await syncAllianceRosterForSession({
      sessionId: "sess-1",
      allianceId: "hq-1",
    });

    expect(resolveOfficerAshedAllianceId).toHaveBeenCalledWith("sess-1");
    expect(syncAllianceMembersFromAshed).toHaveBeenCalledWith({
      hqAllianceId: "hq-1",
      ashedAllianceId: "ashed-from-tag",
      connection: { token: "tok" },
    });
  });

  it("syncs via alliance bot credentials when configured", async () => {
    resolveRosterSyncCapability.mockResolvedValue({ kind: "alliance_ashed" });
    getAllianceById.mockResolvedValue({ ashedAllianceId: "ashed-2" });
    resolveAllianceAshedBotConnection.mockResolvedValue({ token: "bot" });
    syncAllianceMembersFromAshed.mockResolvedValue({ synced: 3 });

    const result = await syncAllianceRosterForSession({
      sessionId: "sess-1",
      allianceId: "hq-2",
    });

    expect(syncAllianceMembersFromAshed).toHaveBeenCalledWith({
      hqAllianceId: "hq-2",
      ashedAllianceId: "ashed-2",
      connection: { token: "bot" },
    });
    expect(result.synced).toBe(3);
    expect(result.capability).toBe("alliance_ashed");
  });
});
