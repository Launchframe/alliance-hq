import { describe, expect, it } from "vitest";

import {
  alliancePickerOptionPlainLabel,
  alliancePickerOptionSearchText,
} from "@/lib/alliance/alliance-picker-label.shared";

describe("alliancePickerOptionPlainLabel", () => {
  it("includes tag, name, and role for membership rows", () => {
    expect(
      alliancePickerOptionPlainLabel({
        id: "a1",
        tag: "LFgo",
        name: "LFgo Alliance",
        slug: "lfgo",
        roleName: "officer",
      }),
    ).toBe("LFgo — LFgo Alliance (officer)");
  });

  it("omits role suffix when roleName is empty", () => {
    expect(
      alliancePickerOptionPlainLabel({
        id: "a1",
        tag: "LFgo",
        name: "LFgo Alliance",
        slug: "lfgo",
        roleName: "",
      }),
    ).toBe("LFgo — LFgo Alliance");
  });
});

describe("alliancePickerOptionSearchText", () => {
  it("includes slug and role for maintainer search", () => {
    expect(
      alliancePickerOptionSearchText({
        id: "a1",
        tag: "LFgo",
        name: "LFgo Alliance",
        slug: "lfgo",
        roleName: "owner",
      }),
    ).toBe("LFgo LFgo Alliance lfgo owner");
  });
});
