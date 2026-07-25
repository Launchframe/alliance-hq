import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveRosterSyncCapability = vi.fn();
const resolveOfficerAshedAllianceId = vi.fn();
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
    resolveOfficerAshedAllianceId.mockResolvedValue({
      connection: { token: "tok" },
      ashedAllianceId: "ashed-1",
    });
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

    expect(syncAllianceMembersFromAshed).toHaveBeenCalledWith({
      hqAllianceId: "hq-1",
      ashedAllianceId: "ashed-1",
      connection: { token: "tok" },
    });
    expect(result.synced).toBe(5);
    expect(result.activeMemberCount).toBe(2);
    expect(result.capability).toBe("officer_ashed");
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
