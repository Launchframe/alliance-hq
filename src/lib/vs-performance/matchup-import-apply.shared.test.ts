import { describe, expect, it } from "vitest";

import {
  applyImportedVsMatchup,
  type VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";

function payload(overrides: Partial<VsWeekPayload> = {}): VsWeekPayload {
  return {
    weekStart: "2026-07-13",
    today: "2026-07-14",
    scope: "week",
    contextScope: "alliance-1",
    canEdit: true,
    leadDays: 2,
    plan: null,
    preferences: { version: 1, defaults: {} as VsWeekPayload["preferences"]["defaults"] },
    days: [],
    matchup: null,
    points: {} as VsWeekPayload["points"],
    pif: null,
    pifError: null,
    canImportAshed: true,
    ashedLinked: true,
    memberScoreChecks: {},
    allianceIdentity: { tag: "LF", name: "Launch", server: 1203 },
    ...overrides,
  };
}

describe("applyImportedVsMatchup", () => {
  it("keeps the local plan and replaces matchup fields", () => {
    const current = payload({
      plan: { version: 4 } as NonNullable<VsWeekPayload["plan"]>,
    });
    const imported = payload({
      plan: { version: 9 } as NonNullable<VsWeekPayload["plan"]>,
      matchup: { id: "m1" } as NonNullable<VsWeekPayload["matchup"]>,
      canImportAshed: false,
    });

    const next = applyImportedVsMatchup(current, imported);
    expect(next?.plan).toEqual(current.plan);
    expect(next?.matchup).toEqual(imported.matchup);
    expect(next?.canImportAshed).toBe(false);
  });

  it("refuses a response for a different week or scope", () => {
    const current = payload();
    expect(
      applyImportedVsMatchup(current, payload({ weekStart: "2026-07-20" })),
    ).toBeNull();
    expect(
      applyImportedVsMatchup(current, payload({ scope: "other" })),
    ).toBeNull();
    expect(
      applyImportedVsMatchup(current, payload({ contextScope: "other" })),
    ).toBeNull();
  });
});
