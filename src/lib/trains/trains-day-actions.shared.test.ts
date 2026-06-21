import { describe, expect, it } from "vitest";

import {
  canManualPickForDate,
  canOfficerChangeTemplateForDate,
  canRollForDate,
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
});
