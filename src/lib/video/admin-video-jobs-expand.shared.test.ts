import { describe, expect, it } from "vitest";

import {
  mergeAdminVideoJobMatchesWithGroupSiblings,
  shouldExpandAdminVideoJobUploadGroups,
} from "./admin-video-jobs-expand.shared";

describe("shouldExpandAdminVideoJobUploadGroups", () => {
  it("expands when there are matches and no passKey filter", () => {
    expect(shouldExpandAdminVideoJobUploadGroups(null, 3)).toBe(true);
    expect(shouldExpandAdminVideoJobUploadGroups("", 1)).toBe(true);
  });

  it("skips expansion when passKey filter is set", () => {
    expect(shouldExpandAdminVideoJobUploadGroups("pass-a", 5)).toBe(false);
  });

  it("skips expansion when the matched set is empty", () => {
    expect(shouldExpandAdminVideoJobUploadGroups(null, 0)).toBe(false);
  });
});

describe("mergeAdminVideoJobMatchesWithGroupSiblings", () => {
  it("returns empty when nothing matched", () => {
    expect(
      mergeAdminVideoJobMatchesWithGroupSiblings([], [{ id: "s1" }]),
    ).toEqual([]);
  });

  it("preserves matched order and appends missing siblings", () => {
    const matched = [{ id: "shadow" }, { id: "solo" }];
    const siblings = [
      { id: "primary" },
      { id: "shadow" },
      { id: "shadow-2" },
    ];
    expect(
      mergeAdminVideoJobMatchesWithGroupSiblings(matched, siblings),
    ).toEqual([{ id: "shadow" }, { id: "solo" }, { id: "primary" }, { id: "shadow-2" }]);
  });

  it("dedupes siblings already present in matched", () => {
    const matched = [{ id: "a" }, { id: "b" }];
    const siblings = [{ id: "b" }, { id: "c" }];
    expect(
      mergeAdminVideoJobMatchesWithGroupSiblings(matched, siblings),
    ).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });
});
