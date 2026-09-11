import { describe, expect, it } from "vitest";
import { noteFieldsSchema, notePatchSchema, noteTitle, notePriorityRank, normalizeNoteLabels } from "./workspace.shared";

describe("note workspace fields", () => {
  it("keeps unprioritized thoughts distinct from low priority", () => {
    expect(noteFieldsSchema.parse({ body: "Some thoughts" }).priority).toBeNull();
    expect(noteFieldsSchema.parse({ body: "Follow up", priority: "low" }).priority).toBe("low");
    expect(notePriorityRank(null)).toBeLessThan(notePriorityRank("low"));
    expect(notePriorityRank("urgent")).toBeGreaterThan(notePriorityRank("high"));
  });

  it("validates real journal dates and bounded fields", () => {
    expect(noteFieldsSchema.safeParse({ body: "Entry", journalDate: "2026-02-30" }).success).toBe(false);
    expect(noteFieldsSchema.safeParse({ body: "Entry", journalDate: "2026-02-28" }).success).toBe(true);
    expect(noteFieldsSchema.safeParse({ body: " ", title: "Title" }).success).toBe(false);
    expect(noteFieldsSchema.safeParse({ body: "Entry", title: "x".repeat(161) }).success).toBe(false);
    expect(noteFieldsSchema.safeParse({ body: "Entry", priority: "critical" }).success).toBe(false);
  });

  it("normalizes labels without losing their language", () => {
    expect(normalizeNoteLabels([" Rally ", "rally", "Estratégia", ""])).toEqual(["Rally", "Estratégia"]);
    expect(noteFieldsSchema.parse({ body: "Entry", notebook: "   " }).notebook).toBeNull();
  });

  it("does not apply creation defaults to partial edits", () => {
    expect(notePatchSchema.parse({ expectedVersion: 2, body: "Updated body" })).toEqual({ expectedVersion: 2, body: "Updated body" });
    expect(notePatchSchema.parse({ expectedVersion: 3, priority: null })).toEqual({ expectedVersion: 3, priority: null });
  });

  it("uses a readable legacy title without changing the original body", () => {
    const note = { title: "", body: "\n## Rally coverage\n\nDetails remain here." };
    expect(noteTitle(note)).toBe("Rally coverage");
    expect(note.body).toContain("## Rally coverage");
    expect(noteTitle({ title: "Custom title", body: "Different first line" })).toBe("Custom title");
  });
});
