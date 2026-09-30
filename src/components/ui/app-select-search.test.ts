import { describe, expect, it } from "vitest";

import { filterAppSelectOptions } from "./app-select-search";

const members = [
  { value: "jam", label: "JăM", searchText: "JăM" },
  { value: "jane", label: "Jane", searchText: "Jane" },
  { value: "ajax", label: "Ajax", searchText: "Ajax" },
  { value: "zed", label: "Zed", searchText: "Zed" },
];

describe("filterAppSelectOptions prefix-alpha", () => {
  it("keeps a one-character prefix, including folded letters", () => {
    const matches = filterAppSelectOptions(
      members,
      "J",
      "fuzzy",
      true,
      "prefix-alpha",
    ).map((option) => option.value);

    expect(matches).toContain("jam");
    expect(matches).toContain("jane");
    expect(matches).not.toContain("zed");
    expect(matches.indexOf("jane")).toBeLessThan(matches.indexOf("ajax"));
    expect(matches.indexOf("jam")).toBeLessThan(matches.indexOf("ajax"));
  });

  it("lists names that start with the query before other matches, alphabetically", () => {
    const matches = filterAppSelectOptions(
      members,
      "J",
      "fuzzy",
      true,
      "prefix-alpha",
    ).map((option) => option.label);

    const prefixes = matches.filter((label) =>
      String(label).toLocaleLowerCase().startsWith("j"),
    );
    expect(prefixes).toEqual(
      [...prefixes].sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
      ),
    );
    expect(matches.at(-1)).toBe("Ajax");
  });

  it("still matches a two-character prefix of a folded name", () => {
    const matches = filterAppSelectOptions(
      members,
      "Ja",
      "fuzzy",
      true,
      "prefix-alpha",
    ).map((option) => option.value);

    expect(matches).toContain("jam");
    expect(matches).toContain("jane");
  });

  it("does not treat a one-character query as a fuzzy hit in score mode", () => {
    const matches = filterAppSelectOptions(members, "J", "fuzzy", true).map(
      (option) => option.value,
    );
    expect(matches).not.toContain("jam");
  });
});
