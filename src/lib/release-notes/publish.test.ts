import path from "node:path";

import { describe, expect, it } from "vitest";

import { compactReleaseNoteForEdgeConfig } from "./markdown";
import {
  collectShippedReleaseNoteEntries,
  HQ_RELEASE_NOTES_EDGE_CONFIG_MAX_BYTES,
} from "./publish";

describe("publishReleaseNotesToEdgeConfig payload", () => {
  it("compact entries stay under the Edge Config item size limit", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../..");
    const entries = collectShippedReleaseNoteEntries(repoRoot);
    const compact = entries.map(compactReleaseNoteForEdgeConfig);
    const payloadBytes = Buffer.byteLength(JSON.stringify(compact), "utf8");

    expect(payloadBytes).toBeLessThan(HQ_RELEASE_NOTES_EDGE_CONFIG_MAX_BYTES);
  });
});
