import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDayConfigsForWeek: vi.fn(),
  loadAllianceRow: vi.fn(),
  resolveWeekFillTemplateResolver: vi.fn(),
}));

vi.mock("@/lib/trains/repository", () => ({
  listDayConfigsForWeek: mocks.listDayConfigsForWeek,
}));

vi.mock("@/lib/trains/rules/week-template-resolve.server", () => ({
  resolveWeekFillTemplateResolver: mocks.resolveWeekFillTemplateResolver,
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadAllianceRow: mocks.loadAllianceRow,
}));

import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { PRESET_WEEK_RULES } from "@/lib/trains/rules/presets.shared";

describe("resolveRollDayConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAllianceRow.mockResolvedValue({ trainWeekStartDow: 2 });
    mocks.resolveWeekFillTemplateResolver.mockResolvedValue(() => ({
      id: "tmpl-vs-push",
      days: PRESET_WEEK_RULES.vs_push_week,
    }));
  });

  it("returns the stored rule for a painted day", async () => {
    mocks.listDayConfigsForWeek.mockResolvedValue([
      {
        id: "day-1",
        date: "2026-08-16",
        conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
        vipRule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
        sourceTemplateId: "vs_push_week",
        isOverride: 1,
      },
    ]);

    const resolved = await resolveRollDayConfig("ally-1", "2026-08-16", "S1");

    expect(resolved.conductorRule).toEqual({
      kind: "rank_pool",
      pool: "r4_plus",
      draw: "wheel",
    });
    expect(resolved.vipRule).toEqual({
      kind: "event_top_x",
      eventKey: "capitol_war",
      topN: 10,
    });
    expect(resolved.dayConfigId).toBe("day-1");
  });

  it("falls back to the week template's rule for an unpainted day", async () => {
    mocks.listDayConfigsForWeek.mockResolvedValue([]);

    // 2026-08-16 is a Sunday — vs_push_week runs R4 rotation with an event VIP.
    const resolved = await resolveRollDayConfig("ally-1", "2026-08-16", "S1");

    expect(resolved.conductorRule).toEqual({
      kind: "rank_pool",
      pool: "r4_plus",
      draw: "wheel",
    });
    expect(resolved.dayConfigId).toBeNull();
  });
});
