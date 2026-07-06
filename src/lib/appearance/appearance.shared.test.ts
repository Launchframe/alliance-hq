import { describe, expect, it } from "vitest";

import {
  isAppearancePreference,
  resolveAppearance,
} from "@/lib/appearance/appearance.shared";

describe("resolveAppearance", () => {
  it("honors explicit light and dark preferences", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("follows system preference when set to system", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });
});

describe("isAppearancePreference", () => {
  it("accepts known preference values", () => {
    expect(isAppearancePreference("system")).toBe(true);
    expect(isAppearancePreference("light")).toBe(true);
    expect(isAppearancePreference("dark")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isAppearancePreference("auto")).toBe(false);
    expect(isAppearancePreference(null)).toBe(false);
  });
});
