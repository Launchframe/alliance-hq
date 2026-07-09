import { describe, expect, it } from "vitest";

import { computeActiveHqLinkCounts } from "@/lib/members/members-linking-metrics.shared";

describe("computeActiveHqLinkCounts", () => {
  it("counts linked and unlinked active roster members only", () => {
    expect(
      computeActiveHqLinkCounts({
        members: [
          { ashed_member_id: "a", status: "active" },
          { ashed_member_id: "b", status: "active" },
          { ashed_member_id: "c", status: "former" },
        ],
        commanderRows: [
          { ashedMemberId: "a", hqLinked: true },
          { ashedMemberId: "b", hqLinked: false },
          { ashedMemberId: "c", hqLinked: false },
        ],
      }),
    ).toEqual({ linked: 1, unlinked: 1, total: 2 });
  });
});
