import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source contract: create POSTs must use the shared timeout under the lease
 * and retain the lease fence on uncertain outcomes (see ashed-sync-post.shared).
 */
describe("ashed-sync POST lease wiring", () => {
  const source = readFileSync(
    new URL("./ashed-sync.server.ts", import.meta.url),
    "utf8",
  );

  it("aborts create POSTs with the shared timeout signal", () => {
    expect(source).toContain("EVENT_SYNC_POST_TIMEOUT_MS");
    expect(source).toContain(
      "signal: AbortSignal.timeout(EVENT_SYNC_POST_TIMEOUT_MS)",
    );
  });

  it("retains the sync-item lease after uncertain create POSTs", () => {
    expect(source).toContain("shouldRetainEventSyncLeaseAfterUncertainPost");
    expect(source).toContain("eventSyncUncertainLeasePatch");
    expect(source).toContain("clearLease: leasePatch.clearLease");
  });
});
