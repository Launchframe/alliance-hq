import { describe, expect, it } from "vitest";
import { boardCommandSchema, orderBoardTasks } from "./board.shared";

describe("officer board commands", () => {
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
