import { describe, expect, it } from "vitest";

import {
  professionLabelKey,
  professionLevelDisplay,
} from "@/lib/professions/profession-label.shared";

describe("professionLabelKey", () => {
  it("maps stored professions to message keys", () => {
    expect(professionLabelKey("War Leader")).toBe("wl");
    expect(professionLabelKey("Engineer")).toBe("eng");
  });

  it("returns null for unset or unknown values", () => {
    expect(professionLabelKey(null)).toBeNull();
    expect(professionLabelKey(undefined)).toBeNull();
    expect(professionLabelKey("Mystery")).toBeNull();
  });
});

describe("professionLevelDisplay", () => {
  it("formats level or dash", () => {
    expect(professionLevelDisplay(7)).toBe("7");
    expect(professionLevelDisplay(0)).toBe("0");
    expect(professionLevelDisplay(null)).toBe("—");
  });
});
