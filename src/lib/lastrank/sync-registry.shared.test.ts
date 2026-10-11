import { describe, expect, it } from "vitest";

import {
  assertLastRankCliIdMatchesFlags,
  isLastRankSelfServiceImportAllowed,
  lastRankCliIdNeedsIdentityCheck,
  LASTRANK_SYNC_REGISTRY,
  listLastRankAutoSyncTargets,
  lookupLastRankSyncByAllianceId,
  lookupLastRankSyncByServerAndTag,
  resolveGameDataSyncStatus,
  resolveLastRankSyncCliTarget,
  type LastRankSyncRegistryEntry,
} from "@/lib/lastrank/sync-registry.shared";

const UNKNOWN_ID = "aabbccddeeff00112233445566778899";

describe("LASTRANK_SYNC_REGISTRY", () => {
  it("includes LFgo on server 1203", () => {
    expect(
      lookupLastRankSyncByServerAndTag(1203, "LFgo"),
    ).toMatchObject({
      gameServerNumber: 1203,
      tag: "LFgo",
      lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
    });
  });

  it("lists the 19 requested alliances plus LFgo", () => {
    expect(LASTRANK_SYNC_REGISTRY).toHaveLength(20);
  });

  it("has unique alliance ids", () => {
    const ids = LASTRANK_SYNC_REGISTRY.map((row) => row.lastrankAllianceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveLastRankSyncCliTarget", () => {
  it("resolves by alliance id from registry", () => {
    expect(
      resolveLastRankSyncCliTarget({
        lastrankAllianceId: "605b91e26dcc4e33b82d114b1846900c",
      }),
    ).toMatchObject({
      gameServerNumber: 1203,
      tag: "BigD",
    });
  });

  it("resolves by server + tag", () => {
    expect(
      resolveLastRankSyncCliTarget({
        gameServerNumber: 1211,
        tag: "Roar",
      }),
    ).toMatchObject({
      lastrankAllianceId: "b1cf340c642947579ccbb753e7410c37",
    });
  });

  it("accepts an unregistered id with server + tag", () => {
    expect(
      resolveLastRankSyncCliTarget({
        lastrankAllianceId: UNKNOWN_ID,
        gameServerNumber: 1300,
        tag: "NeW",
      }),
    ).toEqual({
      gameServerNumber: 1300,
      tag: "NeW",
      lastrankAllianceId: UNKNOWN_ID,
    });
  });

  it("lets explicit server/tag override registry metadata", () => {
    expect(
      resolveLastRankSyncCliTarget({
        lastrankAllianceId: "605b91e26dcc4e33b82d114b1846900c",
        tag: "BigX",
      }),
    ).toEqual({
      gameServerNumber: 1203,
      tag: "BigX",
      lastrankAllianceId: "605b91e26dcc4e33b82d114b1846900c",
    });
  });

  it("asks for server + tag when an unregistered id is passed alone", () => {
    expect(() =>
      resolveLastRankSyncCliTarget({ lastrankAllianceId: UNKNOWN_ID }),
    ).toThrow(/--server and --tag/);
  });

  it("asks for --id when server + tag are not in the registry", () => {
    expect(() =>
      resolveLastRankSyncCliTarget({ gameServerNumber: 1300, tag: "NeW" }),
    ).toThrow(/--id/);
  });

  it("requires server when tag alone is ambiguous across servers", () => {
    expect(() =>
      resolveLastRankSyncCliTarget({ tag: "LFgo" }),
    ).toThrow(/Pass --id/);
  });
});

describe("registry flags", () => {
  const entries: LastRankSyncRegistryEntry[] = [
    {
      gameServerNumber: 1,
      tag: "A",
      lastrankAllianceId: "0".repeat(32),
      selfServiceImport: true,
      autoSync: true,
    },
    {
      gameServerNumber: 1,
      tag: "B",
      lastrankAllianceId: "1".repeat(32),
      selfServiceImport: false,
      autoSync: false,
    },
  ];

  it("lists only autoSync entries for cron", () => {
    expect(listLastRankAutoSyncTargets(entries)).toEqual([
      { gameServerNumber: 1, tag: "A", lastrankAllianceId: "0".repeat(32) },
    ]);
  });

  it("auto-syncs LFgo by default", () => {
    expect(listLastRankAutoSyncTargets().map((row) => row.tag)).toContain(
      "LFgo",
    );
  });

  it("gates self-service import on the flag", () => {
    expect(isLastRankSelfServiceImportAllowed("0".repeat(32), entries)).toBe(
      true,
    );
    expect(isLastRankSelfServiceImportAllowed("1".repeat(32), entries)).toBe(
      false,
    );
    expect(isLastRankSelfServiceImportAllowed(UNKNOWN_ID, entries)).toBe(false);
  });
});

describe("resolveGameDataSyncStatus", () => {
  it("reports nightly sync on for LFgo (case-insensitive tag)", () => {
    expect(resolveGameDataSyncStatus(1203, "lfgo")).toEqual({ linked: true, autoSync: true });
  });

  it("reports linked with nightly sync off for registry alliances not on the cron", () => {
    expect(resolveGameDataSyncStatus(1203, "BigD")).toEqual({ linked: true, autoSync: false });
  });

  it("is not linked for unknown alliances or a tag on the wrong server", () => {
    expect(resolveGameDataSyncStatus(1203, "NOPE")).toEqual({ linked: false });
    expect(resolveGameDataSyncStatus(1211, "LFgo")).toEqual({ linked: false });
  });

  it("is not linked without a server number or tag", () => {
    expect(resolveGameDataSyncStatus(null, "LFgo")).toEqual({ linked: false });
    expect(resolveGameDataSyncStatus(0, "LFgo")).toEqual({ linked: false });
    expect(resolveGameDataSyncStatus(1203, null)).toEqual({ linked: false });
    expect(resolveGameDataSyncStatus(1203, "  ")).toEqual({ linked: false });
  });
});

describe("lookupLastRankSyncByAllianceId", () => {
  it("is case-insensitive on id", () => {
    expect(
      lookupLastRankSyncByAllianceId(
        "B1CF340C642947579CCBB753E7410C37",
      )?.tag,
    ).toBe("Roar");
  });
});

describe("LastRank CLI id identity guard", () => {
  const LFGO_ID = "e7d1eaefdcfc42c8ac6c84247d2dad9b";
  const lfgo = { tag: "LFgo", gameServerNumber: 1203 };

  it("only checks when an id comes with a tag or server", () => {
    expect(lastRankCliIdNeedsIdentityCheck({ lastrankAllianceId: LFGO_ID })).toBe(false);
    expect(lastRankCliIdNeedsIdentityCheck({ tag: "LFgo", gameServerNumber: 1203 })).toBe(false);
    expect(lastRankCliIdNeedsIdentityCheck({ lastrankAllianceId: LFGO_ID, tag: " " })).toBe(false);
    expect(lastRankCliIdNeedsIdentityCheck({ lastrankAllianceId: LFGO_ID, tag: "LFgo" })).toBe(true);
    expect(
      lastRankCliIdNeedsIdentityCheck({ lastrankAllianceId: LFGO_ID, gameServerNumber: 1203 }),
    ).toBe(true);
  });

  it("passes when tag (case-insensitive) and server match", () => {
    expect(() =>
      assertLastRankCliIdMatchesFlags({
        lastrankAllianceId: LFGO_ID,
        tag: "lfgo",
        gameServerNumber: 1203,
        identity: lfgo,
      }),
    ).not.toThrow();
    expect(() =>
      assertLastRankCliIdMatchesFlags({
        lastrankAllianceId: LFGO_ID,
        gameServerNumber: 1203,
        identity: lfgo,
      }),
    ).not.toThrow();
  });

  it("blocks a tag mismatch", () => {
    expect(() =>
      assertLastRankCliIdMatchesFlags({
        lastrankAllianceId: LFGO_ID,
        tag: "BigD",
        gameServerNumber: 1203,
        identity: lfgo,
      }),
    ).toThrow(
      /is \[LFgo\] on server 1203 on LastRank, which does not match --tag BigD --server 1203/,
    );
  });

  it("blocks a server mismatch", () => {
    expect(() =>
      assertLastRankCliIdMatchesFlags({
        lastrankAllianceId: LFGO_ID,
        gameServerNumber: 1211,
        identity: lfgo,
      }),
    ).toThrow(/does not match --server 1211/);
  });

  it("fails closed when the page identity is unreadable", () => {
    expect(() =>
      assertLastRankCliIdMatchesFlags({
        lastrankAllianceId: LFGO_ID,
        tag: "LFgo",
        identity: null,
      }),
    ).toThrow(/Could not read the tag\/server/);
  });

  it("does nothing without a tag or server", () => {
    expect(() =>
      assertLastRankCliIdMatchesFlags({ lastrankAllianceId: LFGO_ID, identity: null }),
    ).not.toThrow();
  });
});
