import { describe, expect, it } from "vitest";

import {
  canClearPendingConductor,
  canManualPickForDate,
  canOfficerChangeTemplateForDate,
  canRollForDate,
  dayMechanismPickerTargetDate,
} from "@/lib/trains/trains-day-actions.shared";

describe("trains-day-actions", () => {
  const today = "2026-06-15";

  it("blocks officer template changes on past days", () => {
    expect(canOfficerChangeTemplateForDate("2026-06-14", today)).toBe(false);
    expect(canOfficerChangeTemplateForDate(today, today)).toBe(true);
    expect(canOfficerChangeTemplateForDate("2026-06-16", today)).toBe(true);
  });

  it("blocks roll/spin on past days", () => {
    expect(canRollForDate("2026-06-14", today)).toBe(false);
    expect(canRollForDate(today, today)).toBe(true);
  });

  it("allows manual pick on past days", () => {
    expect(canManualPickForDate()).toBe(true);
  });

  it("keeps day-mechanism Change on the selected day, not today", () => {
    expect(dayMechanismPickerTargetDate("2026-06-18")).toBe("2026-06-18");
    expect(dayMechanismPickerTargetDate(today)).toBe(today);
  });

  it("allows clearing an unlocked pending conductor, including past days", () => {
    expect(
      canClearPendingConductor({
        conductorMemberId: "m1",
        lockedAt: null,
      }),
    ).toBe(true);
    expect(
      canClearPendingConductor({
        conductorMemberId: "m1",
        lockedAt: "2026-06-15T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(canClearPendingConductor({ conductorMemberId: null, lockedAt: null })).toBe(
      false,
    );
    expect(canClearPendingConductor(null)).toBe(false);
  });
});
