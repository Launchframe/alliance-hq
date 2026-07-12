import { describe, expect, it } from "vitest";

import { sumThpBreakdown, parseThpBreakdownInput } from "@/lib/thp/breakdown.shared";
import { shouldThpAnomalyConfirm } from "@/lib/thp/anomaly";
import { processThpCommand, processThpOcrResult } from "@/lib/thp/command";
import { buildThpDiscordSuccessReply } from "@/lib/thp/discord-success-reply";
import { parsePowerDetailsLines } from "@/lib/thp/hero-power-ocr/parse-power-details";
import { computeThpPercentileChange } from "@/lib/thp/percentile-change";

const translate = (key: string, params?: Record<string, string | number>) => {
  if (key === "thp.success") {
    return `${params?.name} -- total hero power ${params?.total}. That's a ${params?.delta} increase in power in the last ${params?.window}.`;
  }
  if (key === "thp.successFirst") {
    return `${params?.name} -- total hero power ${params?.total}.`;
  }
  if (key === "thp.windowDay") {
    return "1 day";
  }
  if (key === "thp.windowDays") {
    return `${params?.count} days`;
  }
  return key;
};

describe("parsePowerDetailsLines", () => {
  it("parses hero power total and all seven components", () => {
    const lines = [
      "POWER DETAILS",
      "Hero Power 163,460,435",
      "Hero Level 85,813,080",
      "Decorations & Building Stats 37,214,389",
      "Gear 13,059,233",
      "Exclusive Weapon 9,059,449",
      "Hero Tier 7,050,714",
      "Hero Skill 6,560,870",
      "Wall of Honor 4,702,700",
    ];
    const parsed = parsePowerDetailsLines(lines);
    expect(parsed.heroPowerTotal).toBe(163_460_435);
    expect(parsed.complete).toBe(true);
    expect(sumThpBreakdown(parsed.breakdown as never)).toBe(163_460_435);
  });
});

describe("processThpCommand", () => {
  it("sets total when valid", () => {
    const result = processThpCommand({
      explicitTotal: 150_000_000,
      currentTotal: null,
      commanderId: "cmd1",
      pending: null,
      reporterCount: 2,
      peerMax: 100_000_000,
      translate,
      commanderName: "Bravo",
    });
    expect(result.action.type).toBe("set_thp");
    if (result.action.type === "set_thp") {
      expect(result.action.total).toBe(150_000_000);
    }
    expect(result.reply).toContain("Bravo -- total hero power");
  });

  it("requires confirmation for large jumps", () => {
    const result = processThpCommand({
      explicitTotal: 200_000_000,
      currentTotal: 100_000_000,
      commanderId: "cmd1",
      pending: null,
      reporterCount: 12,
      peerMax: 150_000_000,
      translate,
    });
    expect(result.needsConfirmation).toBe(true);
    expect(result.pending?.kind).toBe("anomaly_confirm");
  });
});

describe("processThpOcrResult", () => {
  it("always requires read-back confirm for non-anomalous OCR", () => {
    const result = processThpOcrResult({
      explicitTotal: 120_000_000,
      currentTotal: 100_000_000,
      commanderId: "cmd1",
      pending: null,
      reporterCount: 2,
      peerMax: 100_000_000,
      translate,
    });
    expect(result.needsConfirmation).toBe(true);
    expect(result.pending?.kind).toBe("ocr_confirm");
    expect(result.reply).toBe("thp.ocrConfirm");
    expect(result.action.type).toBe("none");
  });
});

describe("buildThpDiscordSuccessReply", () => {
  it("uses first-report copy when no prior total", () => {
    const reply = buildThpDiscordSuccessReply(translate, {
      commanderName: "Bravo",
      total: 150_000_000,
      previousTotal: null,
      previousAt: null,
    });
    expect(reply).toContain("Bravo -- total hero power");
    expect(reply.endsWith(".")).toBe(true);
    expect(reply).not.toContain("increase in power");
  });

  it("includes growth over days when prior report exists", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    const previousAt = new Date("2026-07-08T12:00:00Z");
    const reply = buildThpDiscordSuccessReply(translate, {
      commanderName: "Bravo",
      total: 160_000_000,
      previousTotal: 150_000_000,
      previousAt,
      now,
    });
    expect(reply).toContain("Bravo -- total hero power");
    expect(reply).toContain("That's a");
    expect(reply).toContain("increase in power in the last 3 days.");
  });
});

describe("computeThpPercentileChange", () => {
  it("returns deltas when history exists", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    const viewerEvents = [
      { commanderId: "a", total: 100, recordedAt: new Date("2026-01-01T00:00:00Z") },
      { commanderId: "a", total: 200, recordedAt: new Date("2026-07-01T00:00:00Z") },
    ];
    const allianceEventsByCommander = new Map([
      [
        "a",
        viewerEvents,
      ],
      [
        "b",
        [
          { commanderId: "b", total: 50, recordedAt: new Date("2026-01-01T00:00:00Z") },
          { commanderId: "b", total: 150, recordedAt: new Date("2026-07-01T00:00:00Z") },
        ],
      ],
    ]);

    const changes = computeThpPercentileChange({
      viewerCommanderId: "a",
      viewerEvents,
      allianceEventsByCommander,
      now,
    });
    expect(changes).toHaveLength(3);
    expect(changes[0]?.days).toBe(30);
  });
});

describe("breakdown validation", () => {
  it("accepts valid breakdown payloads", () => {
    const breakdown = parseThpBreakdownInput({
      heroLevel: 1,
      decorationsAndBuildings: 2,
      gear: 3,
      exclusiveWeapons: 4,
      heroTier: 5,
      heroSkill: 6,
      wallOfHonor: 7,
    });
    expect(breakdown).not.toBeNull();
    expect(sumThpBreakdown(breakdown!)).toBe(28);
  });
});

describe("shouldThpAnomalyConfirm", () => {
  it("flags very high totals", () => {
    expect(
      shouldThpAnomalyConfirm({
        proposedTotal: 250_000_000,
        reporterCount: 12,
        peerMax: 100_000_000,
      }),
    ).toBe(true);
  });
});
