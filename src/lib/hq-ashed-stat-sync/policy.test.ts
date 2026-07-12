import { describe, expect, it } from "vitest";

import { decideInboundStatApply } from "@/lib/hq-ashed-stat-sync/policy";

describe("decideInboundStatApply", () => {
  it("no-ops when totals match", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 100,
        hqLatestSource: "web",
        hqPendingUnsyncedSelfReport: true,
        hqUpdatedAt: new Date("2026-01-02"),
        ashedTotal: 100,
        ashedRecordedAt: new Date("2026-01-01"),
      }),
    ).toBe("noop");
  });

  it("applies when Ashed is higher than HQ", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 100,
        hqLatestSource: "ashed_sync",
        hqPendingUnsyncedSelfReport: false,
        hqUpdatedAt: new Date("2026-01-01"),
        ashedTotal: 150,
        ashedRecordedAt: new Date("2026-01-02"),
      }),
    ).toBe("apply");
  });

  it("conflicts when Ashed would regress a pending self-report", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 200,
        hqLatestSource: "web",
        hqPendingUnsyncedSelfReport: true,
        hqUpdatedAt: new Date("2026-01-02"),
        ashedTotal: 100,
        ashedRecordedAt: new Date("2026-01-03"),
      }),
    ).toBe("conflict");
  });

  it("conflicts when Ashed is lower than a protected HQ source", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 200,
        hqLatestSource: "discord",
        hqPendingUnsyncedSelfReport: false,
        hqUpdatedAt: new Date("2026-01-02"),
        ashedTotal: 100,
        ashedRecordedAt: null,
      }),
    ).toBe("conflict");
  });

  it("applies when HQ has no total yet", () => {
    expect(
      decideInboundStatApply({
        hqTotal: null,
        hqLatestSource: null,
        hqPendingUnsyncedSelfReport: false,
        hqUpdatedAt: null,
        ashedTotal: 50,
        ashedRecordedAt: new Date("2026-01-01"),
      }),
    ).toBe("apply");
  });

  it("no-ops on invalid or non-positive Ashed totals", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 100,
        hqLatestSource: "ashed_sync",
        hqPendingUnsyncedSelfReport: false,
        hqUpdatedAt: new Date("2026-01-01"),
        ashedTotal: 0,
        ashedRecordedAt: new Date("2026-01-02"),
      }),
    ).toBe("noop");
  });

  it("no-ops when unprotected HQ is newer than lower Ashed", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 200,
        hqLatestSource: "ashed_sync",
        hqPendingUnsyncedSelfReport: false,
        hqUpdatedAt: new Date("2026-01-05"),
        ashedTotal: 100,
        ashedRecordedAt: new Date("2026-01-01"),
      }),
    ).toBe("noop");
  });

  it("conflicts when unprotected HQ is older than lower Ashed", () => {
    expect(
      decideInboundStatApply({
        hqTotal: 200,
        hqLatestSource: "ashed_sync",
        hqPendingUnsyncedSelfReport: false,
        hqUpdatedAt: new Date("2026-01-01"),
        ashedTotal: 100,
        ashedRecordedAt: new Date("2026-01-05"),
      }),
    ).toBe("conflict");
  });
});
