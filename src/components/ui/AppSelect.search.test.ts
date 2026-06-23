import { describe, expect, it } from "vitest";

import {
  appSelectOptionMatchesQuery,
  appSelectOptionSearchText,
} from "./AppSelect";

describe("appSelectOptionMatchesQuery", () => {
  it("matches case-insensitive substrings on searchText", () => {
    const option = {
      value: "a1",
      label: "LFgo — Last Friends",
      searchText: "lfgo last friends",
    };
    expect(appSelectOptionMatchesQuery(option, "lfgo")).toBe(true);
    expect(appSelectOptionMatchesQuery(option, "FRI")).toBe(true);
    expect(appSelectOptionMatchesQuery(option, "zzz")).toBe(false);
  });

  it("falls back to string label when searchText is absent", () => {
    const option = { value: "a1", label: "slug — Alliance Name" };
    expect(appSelectOptionSearchText(option)).toBe("slug — Alliance Name");
    expect(appSelectOptionMatchesQuery(option, "alliance")).toBe(true);
  });

  it("returns all options when query is blank", () => {
    const option = { value: "a1", label: "Any" };
    expect(appSelectOptionMatchesQuery(option, "   ")).toBe(true);
  });
});
