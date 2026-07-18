import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  base44Json,
  upsertCommanderLevel,
  getCommanderLevelState,
  loadLatestNonDiscardedEventMeta,
} = vi.hoisted(() => ({
  base44Json: vi.fn(async () => ({})),
  upsertCommanderLevel: vi.fn(async () => true),
  getCommanderLevelState: vi.fn(async () => null),
  loadLatestNonDiscardedEventMeta: vi.fn(async () => ({
    source: null,
    eventId: null,
    ashedSyncedAt: null,
    total: null,
    createdAt: null,
  })),
}));

vi.mock("@/lib/base44/fetch", () => ({ base44Json }));

vi.mock("@/lib/member-level/repository", () => ({
  getCommanderLevelState,
  upsertCommanderLevel,
  getCommanderIdForMember: vi.fn(),
  getCommanderMembershipInAlliance: vi.fn(),
}));

vi.mock("@/lib/hq-ashed-stat-sync/inbound", () => ({
  loadLatestNonDiscardedEventMeta,
  pendingUnsyncedFromMeta: vi.fn(() => false),
  decideAndMaybeApplyInboundStat: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  schema: {
    commanderLevelEvents: { id: "id", ashedSyncedAt: "ashed_synced_at" },
    commanders: { id: "id" },
  },
}));

import { levelStatSyncAdapter } from "@/lib/hq-ashed-stat-sync/level.adapter";
import type { ParsedConnection } from "@/lib/connectionString";

describe("levelStatSyncAdapter", () => {
  beforeEach(() => {
    base44Json.mockClear();
    upsertCommanderLevel.mockClear();
    getCommanderLevelState.mockClear();
    loadLatestNonDiscardedEventMeta.mockClear();
  });

  it("clamps over-cap totals when applying Ashed onto HQ", async () => {
    await levelStatSyncAdapter.applyAshedOnHq({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 90,
      source: "ashed_sync",
    });

    expect(upsertCommanderLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: "cmd1",
        total: 35,
        source: "ashed_sync",
      }),
    );
  });

  it("clamps over-cap totals on outbound PUT to Ashed", async () => {
    const connection = { appId: "app", token: "tok" } as ParsedConnection;
    await levelStatSyncAdapter.putToAshed(connection, "m1", 99);

    expect(base44Json).toHaveBeenCalledWith(
      connection,
      "/entities/Member/m1",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"level":35'),
      }),
    );
  });

  it("leaves in-range totals unchanged", async () => {
    await levelStatSyncAdapter.applyAshedOnHq({
      commanderId: "cmd1",
      allianceId: "a1",
      ashedMemberId: "m1",
      memberName: "Alpha",
      total: 28,
      source: "officer_override",
    });

    expect(upsertCommanderLevel).toHaveBeenCalledWith(
      expect.objectContaining({ total: 28, source: "officer_override" }),
    );
  });
});
