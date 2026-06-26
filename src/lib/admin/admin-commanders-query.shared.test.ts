import { describe, expect, it } from "vitest";

import {
  buildAdminCommandersSearchParams,
  parseAdminCommandersQueryParams,
} from "@/lib/admin/admin-commanders-query.shared";

describe("parseAdminCommandersQueryParams", () => {
  it("parses pagination and detail params", () => {
    const params = parseAdminCommandersQueryParams(
      new URLSearchParams(
        "q=alpha&page=2&limit=50&allianceId=a1&status=active&ashedMemberId=m1&detailAllianceId=a1",
      ),
    );
    expect(params).toEqual({
      q: "alpha",
      page: 2,
      limit: 50,
      allianceId: "a1",
      status: "active",
      ashedMemberId: "m1",
      detailAllianceId: "a1",
    });
  });

  it("builds search params omitting defaults", () => {
    expect(
      buildAdminCommandersSearchParams({
        page: 1,
        limit: 25,
      }),
    ).toBe("");
  });
});
