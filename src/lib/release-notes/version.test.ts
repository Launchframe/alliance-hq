import { describe, expect, it } from "vitest";

import type { ReleaseNoteEntry } from "./types";
import {
  compareAppVersions,
  filterReleaseNotesSince,
  hasUnreadReleaseNotes,
  bumpVersion,
} from "./version";

const notes: ReleaseNoteEntry[] = [
  {
    version: "0.1.0",
    title: "Initial",
    summary: "First",
    bodyMarkdown: "## Summary\n\nFirst",
  },
  {
    version: "0.2.0",
    title: "Second",
    summary: "Second",
    bodyMarkdown: "## Summary\n\nSecond",
  },
];

describe("release note version helpers", () => {
  it("compares semver versions", () => {
    expect(compareAppVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareAppVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  });

  it("filters notes since a last-seen version", () => {
    expect(filterReleaseNotesSince(notes, "0.1.0", "0.2.0")).toEqual([
      notes[1],
    ]);
    expect(filterReleaseNotesSince(notes, null, "0.2.0")).toEqual(notes);
    expect(filterReleaseNotesSince(notes, "0.2.0", "0.2.0")).toEqual([]);
  });

  it("detects unread notes", () => {
    expect(hasUnreadReleaseNotes("0.1.0", "0.2.0", notes)).toBe(true);
    expect(hasUnreadReleaseNotes("0.2.0", "0.2.0", notes)).toBe(false);
  });

  it("bumps package versions", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.0", "major")).toBe("1.0.0");
  });
});
