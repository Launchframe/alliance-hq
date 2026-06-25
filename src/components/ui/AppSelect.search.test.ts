import { describe, expect, it } from "vitest";

import {
  appSelectOptionFuzzyScore,
  appSelectOptionMatchesQuery,
  appSelectOptionSearchText,
  filterAppSelectOptions,
} from "./app-select-search";

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

describe("appSelectOptionFuzzyScore", () => {
  it("ranks close typos above unrelated names", () => {
    const belly = {
      value: "m1",
      label: "Mr BELLY",
      searchText: "Mr BELLY Old Belly",
    };
    const unrelated = {
      value: "m2",
      label: "Totally Different",
      searchText: "Totally Different",
    };
    expect(appSelectOptionFuzzyScore(belly, "belly")).toBeGreaterThan(
      appSelectOptionFuzzyScore(unrelated, "belly"),
    );
  });
});

describe("filterAppSelectOptions", () => {
  const options = [
    { value: "", label: "Unmatched", searchText: "unmatched" },
    { value: "m1", label: "Mr BELLY", searchText: "Mr BELLY" },
    { value: "m2", label: "Bat Pig", searchText: "Bat Pig" },
  ];

  it("keeps the empty option pinned when filtering", () => {
    const filtered = filterAppSelectOptions(options, "belly", "fuzzy");
    expect(filtered[0]?.value).toBe("");
    expect(filtered.some((row) => row.value === "m1")).toBe(true);
  });

  it("sorts fuzzy matches by score", () => {
    const many = [
      { value: "", label: "Clear" },
      { value: "a", label: "Alpha", searchText: "Alpha" },
      { value: "b", label: "Alfa", searchText: "Alfa" },
    ];
    const filtered = filterAppSelectOptions(many, "alfa", "fuzzy");
    expect(filtered[1]?.value).toBe("b");
  });
});
