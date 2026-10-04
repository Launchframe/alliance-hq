import { describe, expect, it } from "vitest";

import { parseActionItemDueDate } from "@/lib/officer-intel/parse-action-item-due.shared";

describe("parseActionItemDueDate", () => {
  const ref = new Date("2026-07-25T10:00:00.000Z");

  it("parses ISO date-only strings", () => {
    const { dueAt, dueHint } = parseActionItemDueDate("2026-07-30", ref);
    expect(dueHint).toBeNull();
    expect(dueAt?.toISOString()).toBe("2026-07-30T12:00:00.000Z");
  });

  it("parses today and tomorrow", () => {
    expect(
      parseActionItemDueDate("today", ref).dueAt?.toISOString(),
    ).toBe("2026-07-25T23:59:59.999Z");
    expect(
      parseActionItemDueDate("tomorrow", ref).dueAt?.toISOString(),
    ).toBe("2026-07-26T23:59:59.999Z");
  });

  it("keeps descriptive hints when not parseable", () => {
    const result = parseActionItemDueDate("before Sunday reset", ref);
    expect(result.dueAt).toBeNull();
    expect(result.dueHint).toBe("before Sunday reset");
  });
});
