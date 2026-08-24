import { describe, expect, it } from "vitest";

import {
  formatLastRankSyncMapEnv,
  LASTRANK_SYNC_REGISTRY,
  lookupLastRankSyncByAllianceId,
  lookupLastRankSyncByServerAndTag,
  resolveLastRankSyncCliTarget,
  resolveLastRankSyncMapTargets,
} from "@/lib/lastrank/sync-registry.shared";

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

  it("whitelists all 19 requested alliances plus LFgo", () => {
    expect(LASTRANK_SYNC_REGISTRY).toHaveLength(20);
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

  it("requires server when tag alone is ambiguous across servers", () => {
    expect(() =>
      resolveLastRankSyncCliTarget({ tag: "LFgo" }),
    ).toThrow(/Pass --id/);
  });
});

describe("resolveLastRankSyncMapTargets", () => {
  it("enriches cron map with registry server numbers", () => {
    const targets = resolveLastRankSyncMapTargets(
      "LFgo=e7d1eaefdcfc42c8ac6c84247d2dad9b,Roar=b1cf340c642947579ccbb753e7410c37",
    );
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ gameServerNumber: 1203, tag: "LFgo" });
    expect(targets[1]).toMatchObject({ gameServerNumber: 1211, tag: "Roar" });
  });

  it("rejects unknown ids not in registry", () => {
    expect(() =>
      resolveLastRankSyncMapTargets(
        "X=aabbccddeeff00112233445566778899",
      ),
    ).toThrow(/not in LASTRANK_SYNC_REGISTRY/);
  });
});

describe("formatLastRankSyncMapEnv", () => {
  it("emits TAG=id pairs for cron", () => {
    const map = formatLastRankSyncMapEnv([
      {
        gameServerNumber: 1203,
        tag: "LFgo",
        lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
      },
    ]);
    expect(map).toBe("LFgo=e7d1eaefdcfc42c8ac6c84247d2dad9b");
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
