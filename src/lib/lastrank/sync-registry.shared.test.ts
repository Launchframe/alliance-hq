import { describe, expect, it } from "vitest";

import {
  isLastRankSelfServiceImportAllowed,
  LASTRANK_SYNC_REGISTRY,
  listLastRankAutoSyncTargets,
  lookupLastRankSyncByAllianceId,
  lookupLastRankSyncByServerAndTag,
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

describe("lookupLastRankSyncByAllianceId", () => {
  it("is case-insensitive on id", () => {
    expect(
      lookupLastRankSyncByAllianceId(
        "B1CF340C642947579CCBB753E7410C37",
      )?.tag,
    ).toBe("Roar");
  });
});
