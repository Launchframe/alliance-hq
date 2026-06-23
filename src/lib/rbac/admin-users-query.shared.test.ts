import { describe, expect, it } from "vitest";

import {
  ADMIN_USERS_PAGE_SIZE_DEFAULT,
  ADMIN_USERS_PAGE_SIZE_MAX,
  buildAdminUsersSearchParams,
  parseAdminUsersQueryParams,
} from "./admin-users-query.shared";

describe("parseAdminUsersQueryParams", () => {
  it("defaults page and limit", () => {
    expect(parseAdminUsersQueryParams(new URLSearchParams())).toEqual({
      q: undefined,
      page: 1,
      limit: ADMIN_USERS_PAGE_SIZE_DEFAULT,
      allianceId: undefined,
      hqUserId: undefined,
      platformMaintainersOnly: false,
    });
  });

  it("parses search filters and clamps limit", () => {
    const params = parseAdminUsersQueryParams(
      new URLSearchParams({
        q: "alice@example.com",
        page: "2",
        limit: "999",
        allianceId: "abc123",
        hqUserId: "user_xyz",
        platformMaintainers: "1",
      }),
    );
    expect(params).toEqual({
      q: "alice@example.com",
      page: 2,
      limit: ADMIN_USERS_PAGE_SIZE_MAX,
      allianceId: "abc123",
      hqUserId: "user_xyz",
      platformMaintainersOnly: true,
    });
  });

  it("treats blank q as undefined", () => {
    expect(
      parseAdminUsersQueryParams(new URLSearchParams({ q: "   " })).q,
    ).toBeUndefined();
  });
});

describe("buildAdminUsersSearchParams", () => {
  it("omits default page and limit", () => {
    expect(
      buildAdminUsersSearchParams({
        page: 1,
        limit: ADMIN_USERS_PAGE_SIZE_DEFAULT,
        platformMaintainersOnly: false,
      }),
    ).toBe("");
  });

  it("serializes non-default query fields", () => {
    const qs = buildAdminUsersSearchParams({
      q: "boggle",
      page: 3,
      limit: 50,
      allianceId: "gNSjrDYk",
      hqUserId: "hq_1",
      platformMaintainersOnly: true,
    });
    const parsed = new URLSearchParams(qs);
    expect(parsed.get("q")).toBe("boggle");
    expect(parsed.get("page")).toBe("3");
    expect(parsed.get("limit")).toBe("50");
    expect(parsed.get("allianceId")).toBe("gNSjrDYk");
    expect(parsed.get("hqUserId")).toBe("hq_1");
    expect(parsed.get("platformMaintainers")).toBe("1");
  });
});
