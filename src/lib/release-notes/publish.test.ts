import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectShippedReleaseNoteEntries,
  publishReleaseNotesToDatabase,
} from "./publish";

describe("publishReleaseNotesToDatabase", () => {
  it("collects shipped markdown entries", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const entries = collectShippedReleaseNoteEntries(repoRoot);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.version && entry.title)).toBe(true);
    expect(entries.every((entry) => entry.bodyMarkdown.length > 0)).toBe(true);
  });

  it("dry-run returns distilled entries without requiring DATABASE_URL", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const result = await publishReleaseNotesToDatabase({
      repoRoot,
      dryRun: true,
      requirePackageVersion: null,
    });

    expect(result.dryRun).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
  });
});
