import { describe, expect, it } from "vitest";

import {
  isMemberEligibleForPool,
  pickLatestAllianceRankEventPerMember,
  resolveMemberPoolAllianceRank,
} from "@/lib/trains/rank-history";
import type { AllianceMember } from "@/lib/db/schema";
import { schema } from "@/lib/db";

type RankEvent = (typeof schema.memberAllianceRankEvents.$inferSelect);

function rankEvent(
  overrides: Partial<RankEvent> &
    Pick<RankEvent, "id" | "allianceRank" | "effectiveDate" | "recordedAt">,
): RankEvent {
  return {
    allianceId: "hq-1",
    ashedMemberId: "m1",
    memberName: "Commander",
    allianceRankTitle: null,
    source: "manual",
    recordedByHqUserId: null,
    ashedSyncedAt: null,
    ...overrides,
  };
}

describe("resolveMemberPoolAllianceRank", () => {
  const baseMember = {
    id: "row-1",
    allianceId: "hq-1",
    ashedMemberId: "m1",
    ashedAllianceId: "ashed-1",
    currentName: "Commander",
    previousNamesJson: [],
    status: "active",
    allianceRank: null,
    allianceRankTitle: null,
    ashedRankRaw: "R3",
  } as unknown as AllianceMember;

  it("prefers HQ rank events over a stale higher synced roster rank", () => {
    expect(
      resolveMemberPoolAllianceRank(baseMember, { allianceRank: 4 }),
    ).toBe(4);
    const demotedRank = resolveMemberPoolAllianceRank(
      { ...baseMember, allianceRank: 4 } as AllianceMember,
      { allianceRank: 3 },
    );
    expect(demotedRank).toBe(3);
    expect(isMemberEligibleForPool("r3", demotedRank)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", demotedRank)).toBe(false);
  });

  it("prefers a newer synced roster rank over a stale lower HQ rank event", () => {
    const promotedRank = resolveMemberPoolAllianceRank(
      {
        ...baseMember,
        allianceRank: 5,
        syncedAt: new Date("2026-08-10T12:00:00Z"),
      } as AllianceMember,
      { allianceRank: 3, effectiveDate: "2026-01-01" },
    );
    expect(promotedRank).toBe(5);
    expect(isMemberEligibleForPool("r3", promotedRank)).toBe(false);
    expect(isMemberEligibleForPool("r4_plus", promotedRank)).toBe(true);
  });

  it("falls back to synced roster rank when no HQ event exists", () => {
    expect(
      resolveMemberPoolAllianceRank(
        { ...baseMember, allianceRank: 4, ashedRankRaw: "R4" } as AllianceMember,
        undefined,
      ),
    ).toBe(4);
  });

  it("falls back to parsed Ashed rank raw like the members list", () => {
    expect(resolveMemberPoolAllianceRank(baseMember, undefined)).toBe(3);
  });

  it("returns null when no HQ event and no synced or Ashed rank", () => {
    expect(
      resolveMemberPoolAllianceRank(
        {
          ...baseMember,
          allianceRank: null,
          ashedRankRaw: null,
        } as AllianceMember,
        null,
      ),
    ).toBe(null);
  });
});

describe("isMemberEligibleForPool", () => {
  it("accepts R4 and R5 for r4_plus", () => {
    expect(isMemberEligibleForPool("r4_plus", 4)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", 5)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", 3)).toBe(false);
    expect(isMemberEligibleForPool("r4_plus", null)).toBe(false);
  });

  it("accepts only R3 for r3 pool", () => {
    expect(isMemberEligibleForPool("r3", 3)).toBe(true);
    expect(isMemberEligibleForPool("r3", 4)).toBe(false);
  });

  it("accepts any rank for heavy_hitter (membership-list pool)", () => {
    expect(isMemberEligibleForPool("heavy_hitter", 3)).toBe(true);
    expect(isMemberEligibleForPool("heavy_hitter", 5)).toBe(true);
    expect(isMemberEligibleForPool("heavy_hitter", null)).toBe(true);
  });
});

describe("pickLatestAllianceRankEventPerMember", () => {
  it("keeps only the latest same-day rank event per member (Ashed retry / concurrent confirm)", () => {
    // Concrete trigger: officer confirms R4, Ashed PUT fails (event kept),
    // then confirms R3 the same ST day. Append-only history has both rows.
    const staleR4 = rankEvent({
      id: "evt-r4",
      allianceRank: 4,
      effectiveDate: "2026-09-09",
      recordedAt: new Date("2026-09-09T10:00:00Z"),
    });
    const correctedR3 = rankEvent({
      id: "evt-r3",
      allianceRank: 3,
      effectiveDate: "2026-09-09",
      recordedAt: new Date("2026-09-09T10:05:00Z"),
    });

    // Pre-fix join-on-max(effectiveDate) returned BOTH rows. Filtering
    // exactRank=3 and exactRank=4 would then place the member in r3 AND r4_plus.
    expect(isMemberEligibleForPool("r3", staleR4.allianceRank)).toBe(false);
    expect(isMemberEligibleForPool("r4_plus", staleR4.allianceRank)).toBe(true);
    expect(isMemberEligibleForPool("r3", correctedR3.allianceRank)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", correctedR3.allianceRank)).toBe(
      false,
    );

    const latest = pickLatestAllianceRankEventPerMember([
      staleR4,
      correctedR3,
    ]);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe("evt-r3");
    expect(latest[0]?.allianceRank).toBe(3);
    expect(isMemberEligibleForPool("r3", latest[0]!.allianceRank)).toBe(true);
    expect(isMemberEligibleForPool("r4_plus", latest[0]!.allianceRank)).toBe(
      false,
    );
  });

  it("prefers a later effectiveDate over a newer recordedAt on an older date", () => {
    const olderDay = rankEvent({
      id: "evt-old",
      allianceRank: 5,
      effectiveDate: "2026-09-08",
      recordedAt: new Date("2026-09-09T12:00:00Z"),
    });
    const newerDay = rankEvent({
      id: "evt-new",
      allianceRank: 3,
      effectiveDate: "2026-09-09",
      recordedAt: new Date("2026-09-09T08:00:00Z"),
    });
    const latest = pickLatestAllianceRankEventPerMember([olderDay, newerDay]);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe("evt-new");
  });
});
