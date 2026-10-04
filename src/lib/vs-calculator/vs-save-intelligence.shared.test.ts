import { describe, expect, it } from "vitest";

import { deriveShinySpawnWeekdaysFromCreationDow } from "@/lib/vs-calculator/shiny-schedule.shared";
import {
  getBusterDayReminderHintKeys,
  getRadarSaveHintKey,
  getShinySaveHintKeys,
} from "@/lib/vs-calculator/vs-save-intelligence.shared";

describe("getRadarSaveHintKey", () => {
  it("Sunday saves for Monday", () => {
    expect(getRadarSaveHintKey("2024-01-07")).toBe("saveRadarForMonday");
  });

  it("Tuesday saves for Wednesday", () => {
    expect(getRadarSaveHintKey("2024-01-09")).toBe("saveRadarForWednesday");
  });

  it("Thursday saves for Friday", () => {
    expect(getRadarSaveHintKey("2024-01-11")).toBe("saveRadarForFriday");
  });

  it("Monday has no radar save hint", () => {
    expect(getRadarSaveHintKey("2024-01-08")).toBeNull();
  });
});

describe("getShinySaveHintKeys", () => {
  const thuServer = deriveShinySpawnWeekdaysFromCreationDow(4);

  it("includes shinySpawnToday on Monday for Thu-created server", () => {
    const keys = getShinySaveHintKeys(thuServer, "2024-01-08");
    expect(keys).toContain("shinySpawnToday");
  });

  it("includes shinySpawnTomorrow on Sunday for Thu-created server", () => {
    const thuServer = deriveShinySpawnWeekdaysFromCreationDow(4);
    const keys = getShinySaveHintKeys(thuServer, "2024-01-07");
    expect(keys).toContain("shinySpawnTomorrow");
  });

  describe("Saturday rollover symmetry", () => {
    // Tue-created server spawns shiny on Tuesday(2) and Saturday(6).
    const satServer = deriveShinySpawnWeekdaysFromCreationDow(2);

    it("includes shinyRolloverSaturday on Saturday itself when it's a spawn day", () => {
      const keys = getShinySaveHintKeys(satServer, "2024-01-13"); // Saturday
      expect(keys).toContain("shinyRolloverSaturday");
      expect(keys).toContain("shinySpawnToday");
    });

    it("includes shinyRolloverSaturday the day before (Friday)", () => {
      const keys = getShinySaveHintKeys(satServer, "2024-01-12"); // Friday
      expect(keys).toContain("shinyRolloverSaturday");
    });

    it("does not include shinyRolloverSaturday when Saturday isn't a spawn day", () => {
      const thuServer = deriveShinySpawnWeekdaysFromCreationDow(4); // Mon/Thu spawns
      const keys = getShinySaveHintKeys(thuServer, "2024-01-13"); // Saturday
      expect(keys).not.toContain("shinyRolloverSaturday");
    });
  });
});

describe("getBusterDayReminderHintKeys", () => {
  it("surfaces shinySpawnToday and shinyRolloverSaturday for a Saturday spawn day", () => {
    const satServer = deriveShinySpawnWeekdaysFromCreationDow(2); // Tue/Sat spawns
    const keys = getBusterDayReminderHintKeys(satServer, "2024-01-13"); // Saturday
    expect(keys).toEqual(
      expect.arrayContaining(["shinySpawnToday", "shinyRolloverSaturday"]),
    );
  });

  it("excludes forward-looking hints like saveShinyForTuesday", () => {
    const satServer = deriveShinySpawnWeekdaysFromCreationDow(2);
    const keys = getBusterDayReminderHintKeys(satServer, "2024-01-13");
    expect(keys).not.toContain("saveShinyForTuesday");
  });

  it("returns an empty array when Saturday isn't a spawn day", () => {
    const thuServer = deriveShinySpawnWeekdaysFromCreationDow(4); // Mon/Thu spawns
    const keys = getBusterDayReminderHintKeys(thuServer, "2024-01-13");
    expect(keys).toEqual([]);
  });
});
