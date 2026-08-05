import { describe, expect, it } from "vitest";

import {
  creationWeekdayFromOpenTimestampMs,
  daysUntilNextShinySpawn,
  deriveShinySpawnWeekdaysFromCreationDow,
  isShinySpawnWeekday,
} from "@/lib/vs-calculator/shiny-schedule.shared";

/** Reference server date from cpt-hedge screenshot (Monday, server calendar). */
const REFERENCE_MONDAY_DOW = 1;

describe("deriveShinySpawnWeekdaysFromCreationDow", () => {
  it("Thu-created servers spawn Mon and Thu", () => {
    expect(deriveShinySpawnWeekdaysFromCreationDow(4)).toEqual([1, 4]);
  });

  it("Fri-created servers spawn Tue and Fri", () => {
    expect(deriveShinySpawnWeekdaysFromCreationDow(5)).toEqual([2, 5]);
  });

  it("Wed-created servers spawn Sun and Wed", () => {
    expect(deriveShinySpawnWeekdaysFromCreationDow(3)).toEqual([0, 3]);
  });

  it("Sat-created servers spawn Wed and Sat", () => {
    expect(deriveShinySpawnWeekdaysFromCreationDow(6)).toEqual([3, 6]);
  });
});

describe("cpt-hedge anchor days-until (reference Monday)", () => {
  const cases: Array<{ creationDow: number; expectedDays: number }> = [
    { creationDow: 4, expectedDays: 0 },
    { creationDow: 5, expectedDays: 1 },
    { creationDow: 3, expectedDays: 2 },
    { creationDow: 6, expectedDays: 2 },
    { creationDow: 2, expectedDays: 1 },
  ];

  it.each(cases)(
    "creation DOW $creationDow → $expectedDays days until shiny",
    ({ creationDow, expectedDays }) => {
      const weekdays = deriveShinySpawnWeekdaysFromCreationDow(creationDow);
      expect(
        daysUntilNextShinySpawn(weekdays, REFERENCE_MONDAY_DOW),
      ).toBe(expectedDays);
    },
  );
});

describe("creationWeekdayFromOpenTimestampMs", () => {
  it("Dec 26 2024 server open is Thursday (UTC−2)", () => {
    const ms = Date.parse("2024-12-26T12:00:00.000-02:00");
    expect(creationWeekdayFromOpenTimestampMs(ms)).toBe(4);
  });
});

describe("isShinySpawnWeekday", () => {
  it("returns true on spawn days only", () => {
    const thuServer = deriveShinySpawnWeekdaysFromCreationDow(4);
    expect(isShinySpawnWeekday(thuServer, 1)).toBe(true);
    expect(isShinySpawnWeekday(thuServer, 4)).toBe(true);
    expect(isShinySpawnWeekday(thuServer, 2)).toBe(false);
  });
});
