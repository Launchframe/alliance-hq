import { describe, expect, it } from "vitest";

import type { LastRankAllianceMember, LastRankMatchedRow } from "@/lib/lastrank/alliance-page.shared";
import {
  buildInteractiveWriteSummaryFromPlan,
  emptyLastRankSyncPlan,
  formatLastRankInteractiveWriteSummaryLines,
  formatLastRankSyncPlanStats,
  lastRankInteractiveWritesNeedConfirm,
  lastRankSyncPlanQueuedCount,
  lastRankSyncPlanStats,
  parseLastRankInteractiveConfirmAnswer,
} from "@/lib/lastrank/sync-plan.shared";

function lastRankMember(
  name: string,
  publicId: number,
): LastRankAllianceMember {
  return {
    publicId,
    name,
    country: null,
    power: null,
    heroPower: null,
    allianceRank: null,
    baseLevel: null,
    profession: null,
    professionLevel: null,
    originServerId: null,
  };
}

function matchedRow(lastRankName: string, publicId: number): LastRankMatchedRow {
  return {
    status: "matched",
    lastRank: lastRankMember(lastRankName, publicId),
    hq: {
      commanderId: `c-${publicId}`,
      ashedMemberId: `m-${publicId}`,
      gameUid: null,
      currentNames: [lastRankName],
      previousNames: [],
      hqThp: null,
      hqLevel: null,
      hqPowerLevel: null,
      hqAllianceRank: null,
      hqProfession: null,
      hqProfessionLevel: null,
      existingCanonicalName: null,
      lastrankPublicId: null,
      lastrankCountry: null,
      lastrankProfileImageUrl: null,
      lastrankProfileUrl: null,
    },
    matchMethod: "interactive",
    fuzzyScore: null,
  };
}

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

describe("interactive write confirmation summary", () => {
  it("needs confirm for renames or creates, not same-name links or retires alone", () => {
    const plan = emptyLastRankSyncPlan();
    plan.mapped.push({
      row: matchedRow("Same", 1),
      priorHqName: "Same",
    });
    plan.retires.push({ ashedMemberId: "m-old", memberName: "Leaver" });
    expect(
      lastRankInteractiveWritesNeedConfirm(
        buildInteractiveWriteSummaryFromPlan(plan),
      ),
    ).toBe(false);

    plan.mapped.push({
      row: matchedRow("NewName", 2),
      priorHqName: "OldName",
    });
    const withRename = buildInteractiveWriteSummaryFromPlan(plan);
    expect(lastRankInteractiveWritesNeedConfirm(withRename)).toBe(true);
    expect(withRename.renames).toEqual([
      { priorHqName: "OldName", lastRankName: "NewName", publicId: 2 },
    ]);

    const createsOnly = emptyLastRankSyncPlan();
    createsOnly.creates.push(lastRankMember("Fresh", 3));
    expect(
      lastRankInteractiveWritesNeedConfirm(
        buildInteractiveWriteSummaryFromPlan(createsOnly),
      ),
    ).toBe(true);
  });

  it("formats rename and create sections for the TTY confirm screen", () => {
    expect(
      formatLastRankInteractiveWriteSummaryLines({
        renames: [
          { priorHqName: "Old", lastRankName: "New", publicId: 9 },
        ],
        creates: [{ lastRankName: "Fresh", publicId: 10 }],
      }),
    ).toEqual([
      "Commander renames:",
      "  - Old → New (public_id=9)",
      "New commanders:",
      "  - Fresh (public_id=10)",
    ]);
  });

  it("accepts y/yes for confirm and declines blank or n", () => {
    expect(parseLastRankInteractiveConfirmAnswer("y")).toBe(true);
    expect(parseLastRankInteractiveConfirmAnswer("Y")).toBe(true);
    expect(parseLastRankInteractiveConfirmAnswer("yes")).toBe(true);
    expect(parseLastRankInteractiveConfirmAnswer(" YES ")).toBe(true);
    expect(parseLastRankInteractiveConfirmAnswer("")).toBe(false);
    expect(parseLastRankInteractiveConfirmAnswer("n")).toBe(false);
    expect(parseLastRankInteractiveConfirmAnswer("no")).toBe(false);
  });
});
