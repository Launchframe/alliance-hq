import { describe, expect, it } from "vitest";

import { resolveRestoreTotalAfterDiscardEvent } from "@/lib/hq-ashed-stat-sync/revert.shared";

describe("resolveRestoreTotalAfterDiscardEvent", () => {
  it("returns rounded previous total when valid", () => {
    expect(
      resolveRestoreTotalAfterDiscardEvent({ previousTotal: 150_000_000.4 }),
    ).toBe(150_000_000);
  });

  it("returns null when there is no previous total", () => {
    expect(resolveRestoreTotalAfterDiscardEvent({ previousTotal: null })).toBe(
      null,
    );
  });

  it("returns null for non-positive totals", () => {
    expect(resolveRestoreTotalAfterDiscardEvent({ previousTotal: 0 })).toBe(
      null,
    );
  });
});
