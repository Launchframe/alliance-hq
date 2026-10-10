import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LastRankAllianceMember,
  LastRankHqRosterRow,
} from "@/lib/lastrank/alliance-page.shared";

const trace = vi.hoisted(() => ({
  order: [] as string[],
  planSnapshots: [] as Array<{ mapped: number; creates: number; retires: number; skipped: number }>,
}));

const rosterDbRows = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

const rankUpdateRows = vi.hoisted(() => ({
  rows: [] as Array<{ ashedAllianceId: string | null }>,
}));

const mocks = vi.hoisted(() => ({
  resolveAlliance: vi.fn(),
  fetchPage: vi.fn(),
  applyInteractiveNameMapping: vi.fn(),
  updateLastRankProfileFields: vi.fn(),
  createAllianceMemberFromLastRank: vi.fn(),
  listActiveMemberIdsNotInSet: vi.fn(),
  retireAllianceMembers: vi.fn(),
  loadAshed: vi.fn(),
  upsertThp: vi.fn(),
  upsertLevel: vi.fn(),
  loadProfessionChanges: vi.fn(),
  lookupPlayer: vi.fn(),
  syncMemberRankToAshed: vi.fn(),
}));

vi.mock("@/lib/trains/rank-sync", () => ({
  syncMemberRankToAshed: mocks.syncMemberRankToAshed,
}));

vi.mock("@/lib/trains/pool-rank-eligibility.server", () => ({
  syncRankEligibilityForCurrentGenerations: vi.fn(),
}));

vi.mock("@/lib/lastrank/alliance-resolve.server", () => ({
  resolveHqAllianceForLastRankSync: mocks.resolveAlliance,
}));

vi.mock("@/lib/lastrank/fetch-alliance.server", () => ({
  fetchLastRankAlliancePage: mocks.fetchPage,
}));

vi.mock("@/lib/lastrank/ashed-credential.server", () => ({
  loadLastRankAshedWriteContext: mocks.loadAshed,
  upsertAllianceAshedCredentialFromConnectionKey: vi.fn(),
  isSyntheticNativeAshedAllianceId: (id: string | null | undefined) =>
    !id?.trim() || id.startsWith("native"),
}));

vi.mock("@/lib/lastrank/sync-upsert.server", () => ({
  applyInteractiveNameMapping: mocks.applyInteractiveNameMapping,
  updateLastRankProfileFields: mocks.updateLastRankProfileFields,
  createAllianceMemberFromLastRank: mocks.createAllianceMemberFromLastRank,
  listActiveMemberIdsNotInSet: mocks.listActiveMemberIdsNotInSet,
  retireAllianceMembers: mocks.retireAllianceMembers,
}));

vi.mock("@/lib/thp/repository", () => ({
  upsertCommanderThp: mocks.upsertThp,
}));

vi.mock("@/lib/member-level/repository", () => ({
  upsertCommanderLevel: mocks.upsertLevel,
}));

vi.mock("@/lib/professions/repository", () => ({
  loadLatestProfessionChangeByCommander: mocks.loadProfessionChanges,
  LASTRANK_SYNC_PROFESSION_SOURCE: "lastrank_sync",
}));

vi.mock("@/lib/professions/service", () => ({
  switchProfession: vi.fn(),
  updateCommanderProfession: vi.fn(),
}));

vi.mock("@/lib/members/member-stat-history.server", () => ({
  appendCommanderPowerLevelEventIfChanged: vi.fn(),
  appendMemberProfessionLevelEventIfChanged: vi.fn(),
}));

vi.mock("@/lib/lastwar/player-lookup.server", () => ({
  lookupPlayerByUid: mocks.lookupPlayer,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => {
        trace.order.push("applyMatchedRows:rank-event");
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: () => ({
        where: () =>
          Object.assign(Promise.resolve(), {
            returning: () => Promise.resolve(rankUpdateRows.rows),
          }),
      }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve(rosterDbRows.rows),
          }),
        }),
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  }),
  schema: {
    commanders: {
      id: "id",
      canonicalName: "canonicalName",
      primaryName: "primaryName",
      gameUid: "gameUid",
      lastrankPublicId: "lastrankPublicId",
      lastrankCountry: "lastrankCountry",
      lastrankProfileImageUrl: "lastrankProfileImageUrl",
      lastrankProfileUrl: "lastrankProfileUrl",
      currentTotalHeroPower: "currentTotalHeroPower",
      memberLevel: "memberLevel",
      powerLevel: "powerLevel",
      profession: "profession",
      professionalLevel: "professionalLevel",
    },
    allianceMembers: {
      id: "id",
      allianceId: "allianceId",
      ashedMemberId: "ashedMemberId",
      currentName: "currentName",
      previousNamesJson: "previousNamesJson",
      status: "status",
      allianceRank: "allianceRank",
      allianceRankTitle: "allianceRankTitle",
      ashedRankRaw: "ashedRankRaw",
      ashedAllianceId: "ashedAllianceId",
      updatedAt: "updatedAt",
    },
    memberAllianceRankEvents: { id: "id" },
    commanderAllianceMemberships: {
      commanderId: "commanderId",
      ashedMemberId: "ashedMemberId",
      allianceId: "allianceId",
    },
  },
}));

import { syncLastRankAlliance } from "@/lib/lastrank/sync-alliance.server";

const target = {
  gameServerNumber: 1203,
  tag: "LFgo",
  lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
};

function lrMember(
  partial: Partial<LastRankAllianceMember> &
    Pick<LastRankAllianceMember, "publicId" | "name">,
): LastRankAllianceMember {
  return {
    country: "US",
    power: 100_000_000,
    heroPower: 40_000_000,
    allianceRank: 3,
    baseLevel: 30,
    profession: null,
    professionLevel: null,
    originServerId: 1203,
    ...partial,
  };
}

function hqRow(
  partial: Partial<LastRankHqRosterRow> &
    Pick<LastRankHqRosterRow, "commanderId" | "ashedMemberId" | "currentNames">,
): LastRankHqRosterRow {
  return {
    previousNames: [],
    gameUid: null,
    hqThp: null,
    hqLevel: null,
    hqPowerLevel: null,
    hqAllianceRank: null,
    hqProfession: null,
    hqProfessionLevel: null,
    existingCanonicalName: null,
    lastrankPublicId: null,
    lastrankCountry: null,
    lastrankProfileImageUrl: null,
    lastrankProfileUrl: null,
    ...partial,
  };
}

function resetTrace(): void {
  trace.order.length = 0;
  trace.planSnapshots.length = 0;
}

function seedHqRoster(rows: LastRankHqRosterRow[]): void {
  rosterDbRows.rows = rows.map((row) => ({
    commanderId: row.commanderId,
    ashedMemberId: row.ashedMemberId,
    currentName: row.currentNames[0] ?? row.commanderId,
    previousNamesJson: row.previousNames,
    status: "active",
    primaryName: null,
    gameUid: row.gameUid,
    canonicalName: row.existingCanonicalName,
    lastrankPublicId: row.lastrankPublicId,
    lastrankCountry: row.lastrankCountry,
    lastrankProfileImageUrl: row.lastrankProfileImageUrl,
    lastrankProfileUrl: row.lastrankProfileUrl,
    hqThp: row.hqThp,
    hqLevel: row.hqLevel,
    hqPowerLevel: row.hqPowerLevel,
    hqProfession: row.hqProfession,
    hqProfessionLevel: row.hqProfessionLevel,
    hqAllianceRank: row.hqAllianceRank,
  }));
}

describe("syncLastRankAlliance batch dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrace();
    mocks.resolveAlliance.mockResolvedValue({
      allianceId: "hq-alliance-1",
      created: false,
    });
    mocks.loadAshed.mockResolvedValue(null);
    mocks.applyInteractiveNameMapping.mockImplementation(async () => {
      trace.order.push("applyInteractiveNameMapping");
      return { renamed: true, ashedSynced: false, canonicalWritten: false };
    });
    mocks.updateLastRankProfileFields.mockImplementation(async () => {
      trace.order.push("updateLastRankProfileFields");
      return true;
    });
    mocks.createAllianceMemberFromLastRank.mockImplementation(async ({ lastRank }) => {
      trace.order.push("createAllianceMemberFromLastRank");
      return {
        hq: hqRow({
          commanderId: `c-new-${lastRank.publicId}`,
          ashedMemberId: `m-new-${lastRank.publicId}`,
          currentNames: [lastRank.name],
        }),
        ashedCreated: false,
      };
    });
    mocks.listActiveMemberIdsNotInSet.mockResolvedValue([
      { ashedMemberId: "m-leaver", currentName: "Leaver" },
    ]);
    mocks.retireAllianceMembers.mockImplementation(async () => {
      trace.order.push("retireAllianceMembers");
      return { retired: 1, ashedRetired: 0, ashedSkipped: 0 };
    });
    mocks.upsertThp.mockImplementation(async () => {
      trace.order.push("applyMatchedRows:thp");
      return false;
    });
    mocks.upsertLevel.mockResolvedValue(false);
    mocks.loadProfessionChanges.mockResolvedValue(new Map());
    mocks.lookupPlayer.mockResolvedValue({ ok: false });
    rosterDbRows.rows = [];
    rankUpdateRows.rows = [];
  });

  it("mirrors changed ranks to Ashed for Ashed-backed members", async () => {
    mocks.loadAshed.mockResolvedValue({
      connection: { token: "t" },
      ashedAllianceId: "ash-1",
    });
    mocks.syncMemberRankToAshed.mockResolvedValue(undefined);
    rankUpdateRows.rows = [{ ashedAllianceId: "ash-1" }];
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 501, name: "Alpha", allianceRank: 4 })],
    });
    seedHqRoster([
      hqRow({
        commanderId: "c-alpha",
        ashedMemberId: "m-alpha",
        currentNames: ["Alpha"],
        hqAllianceRank: 2,
      }),
    ]);

    const result = await syncLastRankAlliance({ target, apply: true });

    expect(mocks.syncMemberRankToAshed).toHaveBeenCalledWith(
      { token: "t" },
      "m-alpha",
      4,
      null,
    );
    expect(result.apply).toEqual(
      expect.objectContaining({ rankApplied: 1, rankAshedSynced: 1, rankAshedFailed: 0 }),
    );
  });

  it("keeps rank writes HQ-only for native members and counts Ashed failures", async () => {
    mocks.loadAshed.mockResolvedValue({
      connection: { token: "t" },
      ashedAllianceId: "ash-1",
    });
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 502, name: "Alpha", allianceRank: 4 })],
    });
    seedHqRoster([
      hqRow({
        commanderId: "c-alpha",
        ashedMemberId: "m-alpha",
        currentNames: ["Alpha"],
        hqAllianceRank: 2,
      }),
    ]);

    rankUpdateRows.rows = [{ ashedAllianceId: "native" }];
    await syncLastRankAlliance({ target, apply: true });
    expect(mocks.syncMemberRankToAshed).not.toHaveBeenCalled();

    rankUpdateRows.rows = [{ ashedAllianceId: "ash-1" }];
    mocks.syncMemberRankToAshed.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await syncLastRankAlliance({ target, apply: true });
    expect(result.apply).toEqual(
      expect.objectContaining({ rankAshedSynced: 0, rankAshedFailed: 1 }),
    );
  });

  it("refuses to write when the alliance no longer matches the plan", async () => {
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 503, name: "Alpha" })],
    });
    seedHqRoster([]);

    await expect(
      syncLastRankAlliance({
        target,
        apply: true,
        expectedHqAllianceId: "some-other-alliance",
      }),
    ).rejects.toThrow(/re-run the plan/);
    expect(mocks.updateLastRankProfileFields).not.toHaveBeenCalled();
  });

  it("dry-run queues interactive maps and writes only after onDispatchStart", async () => {
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 201, name: "Beta" })],
    });
    seedHqRoster([
      hqRow({
        commanderId: "c-old",
        ashedMemberId: "m-old",
        currentNames: ["OldHQ"],
      }),
    ]);

    let dispatchStarted = false;
    const onPlanChanged = vi.fn((stats) => {
      trace.planSnapshots.push({
        mapped: stats.mapped,
        creates: stats.creates,
        retires: stats.retires,
        skipped: stats.skipped,
      });
      expect(dispatchStarted).toBe(false);
      expect(mocks.updateLastRankProfileFields).not.toHaveBeenCalled();
    });
    const onDispatchStart = vi.fn(() => {
      dispatchStarted = true;
      trace.order.push("onDispatchStart");
    });

    await syncLastRankAlliance({
      target,
      apply: false,
      interactivePrompt: async () => ({ kind: "match", hqName: "OldHQ" }),
      onPlanChanged,
      onDispatchStart,
    });

    expect(trace.planSnapshots).toEqual([{ mapped: 1, creates: 0, retires: 0, skipped: 0 }]);
    expect(onDispatchStart).toHaveBeenCalledOnce();
    expect(mocks.applyInteractiveNameMapping).not.toHaveBeenCalled();
    expect(trace.order).toEqual(["onDispatchStart", "updateLastRankProfileFields"]);
  });

  it("apply dispatches renames, creates, matched-row sync, then batched retires", async () => {
    mocks.fetchPage.mockResolvedValue({
      members: [
        lrMember({ publicId: 301, name: "Alpha" }),
        lrMember({ publicId: 302, name: "Beta" }),
        lrMember({ publicId: 303, name: "Gamma" }),
      ],
    });
    seedHqRoster([
      hqRow({
        commanderId: "c-alpha",
        ashedMemberId: "m-alpha",
        currentNames: ["Alpha"],
        hqAllianceRank: 3,
      }),
      hqRow({
        commanderId: "c-old",
        ashedMemberId: "m-old",
        currentNames: ["OldHQ"],
      }),
    ]);

    const onDispatchStart = vi.fn(() => {
      trace.order.push("onDispatchStart");
    });

    await syncLastRankAlliance({
      target,
      apply: true,
      interactivePrompt: async (ctx) => {
        if (ctx.publicId === 302) return { kind: "match", hqName: "OldHQ" };
        if (ctx.publicId === 303) return { kind: "create" };
        return { kind: "skip" };
      },
      retirePrompt: async () => true,
      onDispatchStart,
    });

    expect(mocks.applyInteractiveNameMapping).toHaveBeenCalledOnce();
    expect(mocks.createAllianceMemberFromLastRank).toHaveBeenCalledOnce();
    expect(mocks.retireAllianceMembers).toHaveBeenCalledOnce();
    expect(mocks.retireAllianceMembers).toHaveBeenCalledWith({
      allianceId: "hq-alliance-1",
      ashedMemberIds: ["m-leaver"],
      ashed: null,
    });

    const dispatchIdx = trace.order.indexOf("onDispatchStart");
    const renameIdx = trace.order.indexOf("applyInteractiveNameMapping");
    const createIdx = trace.order.indexOf("createAllianceMemberFromLastRank");
    const thpIdx = trace.order.indexOf("applyMatchedRows:thp");
    const retireIdx = trace.order.indexOf("retireAllianceMembers");

    expect(dispatchIdx).toBeGreaterThanOrEqual(0);
    expect(renameIdx).toBeGreaterThan(dispatchIdx);
    expect(createIdx).toBeGreaterThan(renameIdx);
    expect(thpIdx).toBeGreaterThan(createIdx);
    expect(retireIdx).toBeGreaterThan(thpIdx);
  });

  it("interactive create without --apply counts as skipped and does not queue creates", async () => {
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 401, name: "Gamma" })],
    });
    seedHqRoster([]);

    const onPlanChanged = vi.fn();

    await syncLastRankAlliance({
      target,
      apply: false,
      interactivePrompt: async () => ({ kind: "create" }),
      onPlanChanged,
    });

    expect(onPlanChanged).toHaveBeenCalledWith(
      expect.objectContaining({ creates: 0, skipped: 1 }),
    );
    expect(mocks.createAllianceMemberFromLastRank).not.toHaveBeenCalled();
  });

  it("interactive create skips unranked LastRank rows", async () => {
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 402, name: "Leaver", allianceRank: null })],
    });
    seedHqRoster([]);

    const onPlanChanged = vi.fn();

    await syncLastRankAlliance({
      target,
      apply: true,
      interactivePrompt: async () => ({ kind: "create" }),
      onPlanChanged,
    });

    expect(onPlanChanged).toHaveBeenCalledWith(
      expect.objectContaining({ creates: 0, skipped: 1 }),
    );
    expect(mocks.createAllianceMemberFromLastRank).not.toHaveBeenCalled();
  });

  it("interactive bad HQ name increments skipped without mapping", async () => {
    mocks.fetchPage.mockResolvedValue({
      members: [lrMember({ publicId: 403, name: "Beta" })],
    });
    seedHqRoster([
      hqRow({
        commanderId: "c-old",
        ashedMemberId: "m-old",
        currentNames: ["OldHQ"],
      }),
    ]);

    const onPlanChanged = vi.fn();

    await syncLastRankAlliance({
      target,
      apply: true,
      interactivePrompt: async () => ({ kind: "match", hqName: "Nobody" }),
      onPlanChanged,
    });

    expect(onPlanChanged).toHaveBeenCalledWith(
      expect.objectContaining({ mapped: 0, skipped: 1 }),
    );
    expect(mocks.applyInteractiveNameMapping).not.toHaveBeenCalled();
  });
});
