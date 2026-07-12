import { describe, expect, it } from "vitest";

import { shouldKillsAnomalyConfirm } from "@/lib/kills/anomaly";
import { processKillsCommand } from "@/lib/kills/command";
import { buildKillsDiscordSuccessReply } from "@/lib/kills/discord-success-reply";

const translate = (key: string, params?: Record<string, string | number>) => {
  if (key === "kills.success") {
    return `${params?.name} -- kill count ${params?.total}. Your kills increased by ${params?.delta} over the last ${params?.window}. That's ${params?.kph} kph (kills per hour!)`;
  }
  if (key === "kills.successFirst") {
    return `${params?.name} -- kill count ${params?.total}.`;
  }
  if (key === "kills.windowHours") {
    return `${params?.count} hours`;
  }
  if (key === "kills.windowDays") {
    return `${params?.count} days`;
  }
  if (key === "kills.windowHour") {
    return "1 hour";
  }
  if (key === "kills.windowDay") {
    return "1 day";
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
      commanderName: "Alpha",
    });
    expect(result.action.type).toBe("set_kills");
    if (result.action.type === "set_kills") {
      expect(result.action.total).toBe(150_000_000);
    }
    expect(result.reply).toContain("Alpha -- kill count");
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

describe("buildKillsDiscordSuccessReply", () => {
  it("uses first-report copy when no prior total", () => {
    const reply = buildKillsDiscordSuccessReply(translate, {
      commanderName: "Alpha",
      total: 10_000,
      previousTotal: null,
      previousAt: null,
    });
    expect(reply).toContain("Alpha -- kill count");
    expect(reply.endsWith(".")).toBe(true);
    expect(reply).not.toContain("increased by");
  });

  it("includes growth and kph when prior report exists", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    const previousAt = new Date("2026-07-11T00:00:00Z");
    const reply = buildKillsDiscordSuccessReply(translate, {
      commanderName: "Alpha",
      total: 12_000,
      previousTotal: 10_000,
      previousAt,
      now,
    });
    expect(reply).toContain("Alpha -- kill count");
    expect(reply).toContain("Your kills increased by");
    expect(reply).toContain("over the last 12 hours");
    expect(reply).toContain("kph (kills per hour!)");
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
