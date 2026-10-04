import { describe, expect, it } from "vitest";
import { resourceCursorSchema } from "./pagination.shared";

describe("private resource cursors", () => {
  const base = { version: 1, scope: "alliance:author", key: "a".repeat(64), id: "resource", direction: "next" };
  it("preserves exact timestamps and immutable version positions in both directions", () => {
    for (const position of ["2026-09-16T01:02:03.123456Z", 55]) {
      for (const direction of ["next", "previous"]) expect(resourceCursorSchema.parse({ ...base, position, direction })).toEqual({ ...base, position, direction });
    }
  });
  it("rejects malformed or unbounded cursor data", () => {
    const valid = { ...base, position: 1 };
    for (const patch of [{ version: 2 }, { scope: "" }, { scope: "s".repeat(301) }, { key: "wrong" }, { id: "i".repeat(161) }, { position: 0 }, { position: 1.2 }, { position: "yesterday" }, { position: "0000-01-01T00:00:00.000000Z" }, { direction: "anything" }, { body: "private text" }]) {
      expect(resourceCursorSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });
});
