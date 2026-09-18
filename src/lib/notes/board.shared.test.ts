import { describe, expect, it } from "vitest";
import { boardCommandSchema, orderBoardTasks, summarizeNoteBoard, type NoteBoardSnapshot } from "./board.shared";

describe("officer board commands", () => {
  it("omits document bodies and provenance from board summaries", () => {
    const snapshot: NoteBoardSnapshot = { id: "board", name: "Board", version: 1, allianceId: "alliance", principalId: "author", canWrite: true, people: [], teams: [], tasks: [{ id: "task", title: "Task", description: "Long private body. ".repeat(100), intakeProvenance: null, status: "open", priority: null, labels: [], dueAt: null, completedAt: null, assignee: null, legacyAssigneeName: null, source: null, version: 1, isOwner: true, canEdit: true, shared: true, archived: false, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", position: 3, teamId: "team" }] };
    const summary = summarizeNoteBoard(snapshot);
    expect(summary.tasks[0]).not.toHaveProperty("description");
    expect(summary.tasks[0]).not.toHaveProperty("intakeProvenance");
    expect(summary.tasks[0]).toMatchObject({ position: 3, teamId: "team", excerpt: snapshot.tasks[0].description!.slice(0, 240) });
    expect(snapshot.tasks[0].description!.length).toBeGreaterThan(240);
  });
  it("requires board and canonical task versions for moves", () => {
    expect(boardCommandSchema.safeParse({ kind: "move", requestId: "request-one", expectedVersion: 1, taskId: "task", status: "done" }).success).toBe(false);
    expect(boardCommandSchema.parse({ kind: "move", requestId: "request-one", expectedVersion: 1, expectedTaskVersion: 2, taskId: "task", status: "done" })).toMatchObject({ beforeTaskId: null });
  });
  it("preserves a stable within-column order without duplicates", () => {
    expect(orderBoardTasks(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(orderBoardTasks(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(orderBoardTasks(["a", "b"], "b", "b")).toEqual(["a", "b"]);
    expect(() => orderBoardTasks(["a", "b"], "b", "foreign")).toThrow("invalid");
  });
});
