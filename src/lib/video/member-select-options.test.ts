import { describe, expect, it } from "vitest";

import { buildMemberMatchSelectOptions } from "@/lib/video/member-select-options";

describe("buildMemberMatchSelectOptions", () => {
  it("includes previous names in searchText for fuzzy matching", () => {
    const options = buildMemberMatchSelectOptions(
      [
        {
          id: "m1",
          current_name: "Mr BELLY",
          previous_names: ["Old Belly"],
        },
      ],
      { emptyLabel: "Unmatched" },
    );
    expect(options[1]?.searchText).toBe("Mr BELLY Old Belly");
  });

  it("injects selected members missing from the roster list", () => {
    const options = buildMemberMatchSelectOptions(
      [{ id: "m1", current_name: "Alice" }],
      {
        emptyLabel: "Select member…",
        highlightMemberId: "m2",
        selectedMembers: [
          { memberId: "m2", memberName: "Bob" },
          { memberId: "m1", memberName: "Alice" },
        ],
      },
    );
    expect(options.map((option) => option.value)).toEqual(["", "m1", "m2"]);
    expect(options.find((option) => option.value === "m2")?.label).toBe("Bob");
  });

  it("skips selected members without a name when not in roster", () => {
    const options = buildMemberMatchSelectOptions([], {
      emptyLabel: "Select member…",
      selectedMembers: [{ memberId: "m2", memberName: null }],
    });
    expect(options).toEqual([
      {
        value: "",
        label: "Select member…",
        searchText: "Select member…",
      },
    ]);
  });

  it("keeps members assigned to other rows searchable", () => {
    const options = buildMemberMatchSelectOptions(
      [
        { id: "m1", current_name: "Alice" },
        { id: "m2", current_name: "Bob" },
        { id: "m3", current_name: "Carol" },
        { id: "m4", current_name: "Dave" },
      ],
      {
        emptyLabel: "Unmatched",
        highlightMemberId: "m2",
      },
    );
    expect(options.map((option) => option.value)).toEqual([
      "",
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  it("still injects selected members missing from the roster", () => {
    const options = buildMemberMatchSelectOptions(
      [{ id: "m4", current_name: "Dave" }],
      {
        emptyLabel: "Unmatched",
        highlightMemberId: null,
        selectedMembers: [{ memberId: "m1", memberName: "Alice" }],
      },
    );
    expect(options.map((option) => option.value)).toEqual(["", "m1", "m4"]);
  });
});
