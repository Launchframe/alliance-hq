import { describe, expect, it } from "vitest";
import { taskCreateSchema, taskPatchSchema, normalizeTaskPriority, taskCompletedAt } from "./tasks.shared";

describe("canonical Notes tasks", () => {
  it("keeps None distinct from Low and normalizes legacy Normal", () => {
    expect(taskCreateSchema.parse({ title: "Follow up" }).priority).toBeNull();
    expect(normalizeTaskPriority("normal")).toBe("medium");
    expect(taskCreateSchema.parse({ title: "Follow up", priority: "low" }).priority).toBe("low");
  });
  it("never applies creation defaults to a partial edit", () => {
    expect(taskPatchSchema.parse({ expectedVersion: 1, title: "Changed" })).toEqual({ expectedVersion: 1, title: "Changed" });
    expect(taskPatchSchema.parse({ expectedVersion: 2, priority: null })).toEqual({ expectedVersion: 2, priority: null });
  });
  it("does not treat None as a lifecycle state or accept invalid fields", () => {
    expect(taskCreateSchema.safeParse({ title: "Todo", status: "none" }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: " " }).success).toBe(false);
    expect(taskPatchSchema.safeParse({ expectedVersion: 0, status: "done" }).success).toBe(false);
  });
  it("records completion once and clears it on reopening", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const earlier = new Date("2026-09-12T12:00:00Z");
    expect(taskCompletedAt("done", null, now)).toEqual(now);
    expect(taskCompletedAt("done", earlier, now)).toEqual(earlier);
    expect(taskCompletedAt("in_progress", earlier, now)).toBeNull();
  });
});
