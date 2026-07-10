import { describe, expect, it } from "vitest";

import {
  extractHistoricalNotes,
  filterNoteSuggestions,
} from "@/lib/battle-plan/notes-suggestions.shared";

describe("notes suggestions", () => {
  it("dedupes historical notes case-insensitively, newest first", () => {
    expect(
      extractHistoricalNotes([
        { notes: "  Rally at TP  ", updatedAt: "2026-07-01T12:00:00.000Z" },
        { notes: "rally at tp", updatedAt: "2026-07-02T12:00:00.000Z" },
        { notes: "Bring shields", updatedAt: "2026-07-03T12:00:00.000Z" },
      ]),
    ).toEqual(["Bring shields", "rally at tp"]);
  });

  it("filters suggestions by case-insensitive substring", () => {
    const notes = ["Rally at TP", "Bring shields", "City cleanup"];
    expect(filterNoteSuggestions(notes, "rally")).toEqual(["Rally at TP"]);
    expect(filterNoteSuggestions(notes, "SH")).toEqual(["Bring shields"]);
  });
});
