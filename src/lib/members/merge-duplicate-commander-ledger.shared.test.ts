import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  hqEventSyncRemoteKey,
  MERGE_MEMBER_LEDGER_TABLES,
} from "./merge-duplicate-commander-ledger.shared";

describe("hqEventSyncRemoteKey", () => {
  it("matches JS template null stringification used by evidence sync", () => {
    expect(hqEventSyncRemoteKey("evt", "board-1", "m-kept")).toBe(
      "evt:board-1:m-kept",
    );
    expect(hqEventSyncRemoteKey("evt", null, "m-kept")).toBe("evt:null:m-kept");
  });
});

describe("merge duplicate member ledgers", () => {
  it("remaps modern event evidence + VS compliance tables (beyond legacy hq_event_members)", () => {
    const source = readFileSync(
      new URL("./merge-duplicate-commander.server.ts", import.meta.url),
      "utf8",
    );
    for (const table of MERGE_MEMBER_LEDGER_TABLES) {
      expect(source, `missing remap for ${table}`).toContain(table);
    }
    // Collision policy: kept wins before remap (same as vs_score_heads).
    expect(source).toContain("DELETE FROM hq_event_member_results AS dup");
    expect(source).toContain("DELETE FROM vs_compliance_evaluations AS dup_eval");
  });
});
