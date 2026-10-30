import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AllianceMember } from "@/lib/db/schema";
import { ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS } from "@/lib/members/roster-sync.shared";
import { allianceMembersAfterOptionalAshedSync } from "@/lib/members/roster-ashed-sync.server";

function rosterRow(id: string): AllianceMember {
  return {
    id,
    allianceId: "hq1",
    ashedMemberId: `m-${id}`,
    ashedAllianceId: "a1",
    currentName: "Alice",
    previousNamesJson: [],
    status: "active",
    allianceRank: null,
    allianceRankTitle: null,
    ashedRankRaw: null,
    joinDate: null,
    notes: null,
    timezone: null,
    recordedDate: null,
    ashedCreatedAt: null,
    ashedUpdatedAt: null,
    squadPowerSnapshotsJson: null,
    mainSquad: null,
    isSample: null,
    gameUid: null,
    commanderSyncStatus: "synced",
    commanderConflictJson: null,
    syncedAt: new Date("2026-07-07T10:00:00.000Z"),
    createdAt: new Date("2026-07-07T10:00:00.000Z"),
    updatedAt: new Date("2026-07-07T10:00:00.000Z"),
  };
}

describe("allianceMembersAfterOptionalAshedSync", () => {
  const syncFromAshed = vi.fn<() => Promise<void>>();
  const reloadMembers = vi.fn<() => Promise<AllianceMember[]>>();
  const enqueueBackgroundSync = vi.fn<() => Promise<void>>();
  const now = Date.parse("2026-07-07T12:00:00.000Z");
  const freshSyncedAt = new Date(now - 60 * 60 * 1000);
  const staleSyncedAt = new Date(now - ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS - 1);
  const localRows = [rosterRow("1"), rosterRow("2")];
  const reloadedRows = [rosterRow("1"), rosterRow("2"), rosterRow("3")];

  beforeEach(() => {
    syncFromAshed.mockReset();
    reloadMembers.mockReset();
    enqueueBackgroundSync.mockReset();
    syncFromAshed.mockResolvedValue(undefined);
    reloadMembers.mockResolvedValue(reloadedRows);
    enqueueBackgroundSync.mockResolvedValue(undefined);
    vi.setSystemTime(now);
  });

  it("returns local rows without syncing when cache is fresh", async () => {
    const result = await allianceMembersAfterOptionalAshedSync({
      forceRefresh: false,
      lastSyncedAt: freshSyncedAt,
      localRows,
      syncFromAshed,
      reloadMembers,
      enqueueBackgroundSync,
    });

    expect(result).toBe(localRows);
    expect(syncFromAshed).not.toHaveBeenCalled();
    expect(reloadMembers).not.toHaveBeenCalled();
    expect(enqueueBackgroundSync).not.toHaveBeenCalled();
  });

  it("enqueues background sync when cache is stale and roster is non-empty", async () => {
    const result = await allianceMembersAfterOptionalAshedSync({
      forceRefresh: false,
      lastSyncedAt: staleSyncedAt,
      localRows,
      syncFromAshed,
      reloadMembers,
      enqueueBackgroundSync,
    });

    expect(enqueueBackgroundSync).toHaveBeenCalledOnce();
    expect(syncFromAshed).not.toHaveBeenCalled();
    expect(reloadMembers).not.toHaveBeenCalled();
    expect(result).toBe(localRows);
  });

  it("awaits sync when local roster is empty", async () => {
    await allianceMembersAfterOptionalAshedSync({
      forceRefresh: false,
      lastSyncedAt: freshSyncedAt,
      localRows: [],
      syncFromAshed,
      reloadMembers,
      enqueueBackgroundSync,
    });

    expect(syncFromAshed).toHaveBeenCalledOnce();
    expect(reloadMembers).toHaveBeenCalledOnce();
    expect(enqueueBackgroundSync).not.toHaveBeenCalled();
  });

  it("enqueues on force refresh when roster is non-empty", async () => {
    const result = await allianceMembersAfterOptionalAshedSync({
      forceRefresh: true,
      lastSyncedAt: freshSyncedAt,
      localRows,
      syncFromAshed,
      reloadMembers,
      enqueueBackgroundSync,
    });

    expect(enqueueBackgroundSync).toHaveBeenCalledOnce();
    expect(syncFromAshed).not.toHaveBeenCalled();
    expect(result).toBe(localRows);
  });

  it("falls back to blocking sync when enqueue is omitted", async () => {
    await allianceMembersAfterOptionalAshedSync({
      forceRefresh: true,
      lastSyncedAt: freshSyncedAt,
      localRows,
      syncFromAshed,
      reloadMembers,
    });

    expect(syncFromAshed).toHaveBeenCalledOnce();
    expect(reloadMembers).toHaveBeenCalledOnce();
  });

  it("awaits sync when lastSyncedAt is missing and roster is empty", async () => {
    await allianceMembersAfterOptionalAshedSync({
      forceRefresh: false,
      lastSyncedAt: null,
      localRows: [],
      syncFromAshed,
      reloadMembers,
      enqueueBackgroundSync,
    });

    expect(syncFromAshed).toHaveBeenCalledOnce();
    expect(enqueueBackgroundSync).not.toHaveBeenCalled();
  });
});
