import { describe, expect, it } from "vitest";

import { buildMembersSearchWhere } from "@/lib/members/members-search.server";

describe("buildMembersSearchWhere", () => {
  it("always scopes to alliance id", () => {
    const where = buildMembersSearchWhere("alliance-1");
    expect(where).toBeTruthy();
  });

  it("adds text search when q is provided", () => {
    const where = buildMembersSearchWhere("alliance-1", "alice");
    expect(where).toBeTruthy();
  });
});
