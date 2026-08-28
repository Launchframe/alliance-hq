import { describe, expect, it } from "vitest";

import { deriveShinySpawnWeekdaysFromCreationDow } from "@/lib/vs-calculator/shiny-schedule.shared";
import {
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
});
