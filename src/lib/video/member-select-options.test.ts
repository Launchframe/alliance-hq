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
});
