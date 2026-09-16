import { describe, expect, it } from "vitest";
import { noteFieldsSchema, notePatchSchema, noteRouteId, noteTitle, notePriorityRank, normalizeNoteLabels, notesWorkspaceLocation, noteListFilterSchema, parseNoteListCursor } from "./workspace.shared";

describe("note list boundaries", () => {
  it("normalizes bounded filters without inventing a priority", () => {
    expect(noteListFilterSchema.parse({})).toEqual({ view: "notebook", q: "", notebook: "", source: "", priority: "all", sort: "recent" });
    expect(noteListFilterSchema.safeParse({ priority: "none", source: "discord" }).success).toBe(true);
    expect(noteListFilterSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(noteListFilterSchema.safeParse({ sort: "arbitrary" }).success).toBe(false);
  });
  it("preserves exact cursor timestamps and rejects malformed query lineage", () => {
    const cursor = { version: 1, scope: "alliance:author", key: "a".repeat(64), id: "meeting:legacy", updatedAt: "2026-09-16T01:02:03.123456Z", rank: 0 };
    expect(parseNoteListCursor(JSON.stringify(cursor))).toEqual(cursor);
    expect(parseNoteListCursor(null)).toBeNull();
    for (const value of ["{}", "null", "x".repeat(901), JSON.stringify({ ...cursor, rank: 5 }), JSON.stringify({ ...cursor, updatedAt: "yesterday" })]) expect(() => parseNoteListCursor(value)).toThrow();
  });
});

describe("note workspace fields", () => {
  it("normalizes canonical meeting IDs across locale rewrites without decoding arbitrary paths", () => {
    expect(noteRouteId("meeting%3Alegacy-id")).toBe("meeting:legacy-id");
    expect(noteRouteId("meeting:legacy-id")).toBe("meeting:legacy-id");
    expect(noteRouteId("ordinary-note")).toBe("ordinary-note");
    expect(noteRouteId("other%2Fpath")).toBe("other%2Fpath");
  });
  it("preserves authorized board and filter deep links while changing focus", () => {
    expect(notesWorkspaceLocation("/pt-BR/notes", "?view=boards&board=one&task=old", { task: "next", boardGroup: "assignee" })).toBe("/pt-BR/notes?view=boards&board=one&task=next&boardGroup=assignee");
    expect(notesWorkspaceLocation("/notes", "?task=old", { task: null })).toBe("/notes");
  });
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
