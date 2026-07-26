import { describe, expect, it } from "vitest";

import { entryToRow, rowToEntry } from "./db";
import type { ReleaseNoteEntry } from "./types";

describe("release notes db mapping", () => {
  it("round-trips a full entry including optional arrays and shippedAt", () => {
    const entry: ReleaseNoteEntry = {
      version: "0.19.0",
      title: "Release title",
      summary: "- Feature one\n- Feature two",
      bodyMarkdown:
        "## Summary\n\n- Feature one\n- Feature two\n\n## Breaking changes\n\n- API change\n\n## Platform maintainer notes\n\n- Run db:migrate",
      breaking: ["API change"],
      maintainerNotes: ["Run db:migrate"],
      shippedAt: "2026-07-26T12:00:00.000Z",
    };

    const row = entryToRow(entry);
    expect(row.version).toBe("0.19.0");
    expect(row.breaking).toEqual(["API change"]);
    expect(row.maintainerNotes).toEqual(["Run db:migrate"]);
    expect(row.shippedAt?.toISOString()).toBe("2026-07-26T12:00:00.000Z");

    const restored = rowToEntry({
      ...row,
      updatedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(restored).toEqual(entry);
  });

  it("omits empty optional arrays and missing shippedAt", () => {
    const entry: ReleaseNoteEntry = {
      version: "0.1.0",
      title: "Launch",
      summary: "Initial release",
      bodyMarkdown: "## Summary\n\nInitial release",
    };

    const row = entryToRow(entry);
    expect(row.breaking).toBeNull();
    expect(row.maintainerNotes).toBeNull();
    expect(row.shippedAt).toBeNull();

    expect(rowToEntry({ ...row, updatedAt: new Date() })).toEqual(entry);
  });
});
