import { describe, expect, it } from "vitest";

import {
  emptyLastRankSyncPlan,
  formatLastRankSyncPlanStats,
  lastRankSyncPlanQueuedCount,
  lastRankSyncPlanStats,
} from "@/lib/lastrank/sync-plan.shared";

describe("LastRank sync plan stats", () => {
  it("counts queued decisions separately from skips", () => {
    const plan = emptyLastRankSyncPlan();
    plan.retires.push({ ashedMemberId: "m1", memberName: "Old" });
    plan.skipped = 2;
    const stats = lastRankSyncPlanStats(plan, 4);
    expect(stats).toEqual({
      mapped: 0,
      creates: 0,
      retires: 1,
      skipped: 2,
      remaining: 4,
    });
    expect(lastRankSyncPlanQueuedCount(stats)).toBe(1);
  });

  it("formats a summary that says nothing is written yet", () => {
    expect(
      formatLastRankSyncPlanStats({
        mapped: 3,
        creates: 1,
        retires: 0,
        skipped: 2,
        remaining: 5,
      }),
    ).toBe(
      "Queued: 3 mapped, 1 to create, 0 to retire, 2 skipped, 5 left in this step — nothing written yet.",
    );
    expect(
      formatLastRankSyncPlanStats({
        mapped: 0,
        creates: 0,
        retires: 0,
        skipped: 0,
        remaining: 0,
      }),
    ).toBe("Queued: 0 mapped, 0 to create, 0 to retire, 0 skipped — nothing written yet.");
  });
});
