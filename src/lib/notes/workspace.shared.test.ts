import { describe, expect, it, vi } from "vitest";
import { createNotesNavigation } from "./navigation.shared";
import { noteFieldsSchema, notePatchSchema, noteRouteId, noteTitle, notePriorityRank, normalizeNoteLabels, notesWorkspaceLocation, noteListFilterSchema, parseNoteListCursor, noteWorkspaceStateSchema, readWorkspaceState, workspaceStateLocation, workspacePreferenceWriteSchema, scopedWorkspaceLocation, readNoteListFilter } from "./workspace.shared";

describe("guarded Notes navigation", () => {
  it("keeps the current view until unsaved changes are resolved", async () => {
    const commit = vi.fn(), restore = vi.fn(), keep = vi.fn();
    const store = createNotesNavigation({ url: "/notes?note=one", commit, restore });
    store.register(() => ({ dirty: true, keep }));
    store.request({ url: "/notes?view=tasks", mode: "external", index: 0 });
    expect(store.getSnapshot().url).toBe("/notes?note=one");
    expect(commit).not.toHaveBeenCalled();
    await store.resolve("cancel");
    expect(restore).toHaveBeenCalledWith("/notes?note=one", 0, 0);
    store.request({ url: "/notes?view=tasks", mode: "push" });
    await store.resolve("keep");
    expect(keep).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("/notes?view=tasks", "push", 1);
  });
  it("does not discard edits for a non-destructive layout change", () => {
    const commit = vi.fn();
    const store = createNotesNavigation({ url: "/notes?note=one", commit, restore: vi.fn() });
    store.register(() => ({ dirty: true }));
    store.request({ url: "/notes?note=one&layout=list", mode: "push" });
    expect(commit).toHaveBeenCalledOnce();
    expect(store.getSnapshot().pending).toBeNull();
  });
  it("never changes history after the owning workspace is disposed", async () => {
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => { finish = resolve; });
    const commit = vi.fn(), store = createNotesNavigation({ url: "/notes?draft=one", commit, restore: vi.fn() });
    store.register(() => ({ dirty: true, keep: () => saved }));
    store.request({ url: "/notes", mode: "push" });
    const resolution = store.resolve("keep"); store.dispose(); finish(); await resolution;
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("scoped workspace navigation", () => {
  const scope = "alliance:author";
  it("uses saved preferences only as defaults for explicit URL state", () => {
    const saved = noteWorkspaceStateSchema.parse({ view: "shared", source: "discord", layout: "list", boardGroup: "team" });
    expect(readWorkspaceState(new URLSearchParams(), saved, scope)).toEqual(saved);
    expect(readWorkspaceState(new URLSearchParams("view=inbox&source=web&boardClosed=1"), saved, scope)).toMatchObject({ view: "inbox", source: "web", layout: "list", boardClosed: true });
  });
  it("round trips Unicode filters and keeps bodies and focus out of persisted preferences", () => {
    const state = noteWorkspaceStateSchema.parse({ view: "notebook", notebook: "Estratégia", q: "rally plan", priority: "none", layout: "list" });
    const url = workspaceStateLocation("/pt-BR/notes", "?note=one", state, scope);
    expect(readWorkspaceState(new URLSearchParams(url.split("?")[1]), noteWorkspaceStateSchema.parse({}), scope)).toEqual(state);
    expect(url).toContain("note=one");
    expect(workspacePreferenceWriteSchema.safeParse({ expectedScope: scope, expectedVersion: 0, state: { ...state, body: "private text" } }).success).toBe(false);
    expect(workspacePreferenceWriteSchema.safeParse({ expectedScope: scope, expectedVersion: 0, state: { ...state, note: "one" } }).success).toBe(false);
  });
  it("normalizes scoped defaults without carrying private filters onto other pages", () => {
    const saved = noteWorkspaceStateSchema.parse({ q: "Private query", view: "inbox" });
    expect(scopedWorkspaceLocation("/teamwork", saved, scope)).toBe("/teamwork");
    const normalized = new URL(scopedWorkspaceLocation("/pt-BR/notes?workspaceScope=other&note=shared&cursor=stale&q=Other", saved, scope), "https://notes.invalid");
    expect(normalized.searchParams.get("q")).toBe("Private query");
    expect(normalized.searchParams.get("note")).toBe("shared");
    expect(normalized.searchParams.has("cursor")).toBe(false);
    expect(normalized.searchParams.get("workspaceScope")).toBe(scope);
    expect(readWorkspaceState(new URLSearchParams("q=Two+words+"), saved, scope).q).toBe("Two words ");
  });
  it("does not apply another account or alliance's URL preferences", () => {
    const saved = noteWorkspaceStateSchema.parse({ view: "tasks" });
    const params = new URLSearchParams({ workspaceScope: "other:principal", view: "notebook", notebook: "Private folder", q: "Private query" });
    expect(readWorkspaceState(params, saved, scope)).toEqual(saved);
  });
});

describe("note list boundaries", () => {
  it("restores exact label and member filters without interpreting them as search text", () => {
    expect(readNoteListFilter(new URLSearchParams({ label: "Raid planning", member: "commander-reference" }))).toMatchObject({ label: "Raid planning", member: "commander-reference", q: "" });
    expect(noteListFilterSchema.safeParse({ label: "x".repeat(33) }).success).toBe(false);
    expect(noteWorkspaceStateSchema.parse({ boardLabel: "Raid planning" }).boardLabel).toBe("Raid planning");
  });
  it("normalizes bounded filters without inventing a priority", () => {
    expect(noteListFilterSchema.parse({})).toEqual({ view: "notebook", q: "", notebook: "", source: "", priority: "all", sort: "recent", label: "", member: "" });
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
