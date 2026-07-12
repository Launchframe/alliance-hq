import { describe, expect, it } from "vitest";

import { shouldKillsAnomalyConfirm } from "@/lib/kills/anomaly";
import { processKillsCommand } from "@/lib/kills/command";

const translate = (key: string, params?: Record<string, string | number>) => {
  if (key === "kills.success") {
    return `saved ${params?.total}`;
  }
  return key;
};

describe("processKillsCommand", () => {
  it("sets total when valid", () => {
    const result = processKillsCommand({
      explicitTotal: 150_000_000,
      currentTotal: null,
      commanderId: "cmd1",
      pending: null,
      reporterCount: 2,
      peerMax: 100_000_000,
      translate,
    });
    expect(result.action.type).toBe("set_kills");
    if (result.action.type === "set_kills") {
      expect(result.action.total).toBe(150_000_000);
    }
  });

  it("requires confirmation for large jumps", () => {
    const result = processKillsCommand({
      explicitTotal: 200_000_000,
      currentTotal: 100_000_000,
      commanderId: "cmd1",
      pending: null,
      reporterCount: 12,
      peerMax: 140_000_000,
      translate,
    });
    expect(result.needsConfirmation).toBe(true);
    expect(result.pending?.kind).toBe("anomaly_confirm");
  });
});

describe("shouldKillsAnomalyConfirm", () => {
  it("flags very high totals", () => {
    expect(
      shouldKillsAnomalyConfirm({
        proposedTotal: 2_500_000_000,
        reporterCount: 12,
        peerMax: 100_000_000,
      }),
    ).toBe(true);
  });

  it("flags peer gap above threshold", () => {
    expect(
      shouldKillsAnomalyConfirm({
        proposedTotal: 200_000_000,
        reporterCount: 12,
        peerMax: 140_000_000,
      }),
    ).toBe(true);
  });

  it("skips when too few reporters", () => {
    expect(
      shouldKillsAnomalyConfirm({
        proposedTotal: 2_500_000_000,
        reporterCount: 3,
        peerMax: 100_000_000,
      }),
    ).toBe(false);
  });
});
