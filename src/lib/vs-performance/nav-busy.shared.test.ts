import { describe, expect, it } from "vitest";

import { resolveVsPerformanceBusyState } from "@/lib/vs-performance/nav-busy.shared";

describe("resolveVsPerformanceBusyState", () => {
  it("does not lock week chrome for auto-import alone", () => {
    expect(
      resolveVsPerformanceBusyState({
        hasDraft: false,
        loading: false,
        needsAutoPull: true,
        autoPulling: false,
      }),
    ).toEqual({ navLocked: false, matchupImportBusy: true });

    expect(
      resolveVsPerformanceBusyState({
        hasDraft: false,
        loading: false,
        needsAutoPull: false,
        autoPulling: true,
      }),
    ).toEqual({ navLocked: false, matchupImportBusy: true });
  });

  it("still locks week chrome for drafts and week loads", () => {
    expect(
      resolveVsPerformanceBusyState({
        hasDraft: true,
        loading: false,
        needsAutoPull: false,
        autoPulling: false,
      }).navLocked,
    ).toBe(true);

    expect(
      resolveVsPerformanceBusyState({
        hasDraft: false,
        loading: true,
        needsAutoPull: false,
        autoPulling: false,
      }).navLocked,
    ).toBe(true);
  });
});
