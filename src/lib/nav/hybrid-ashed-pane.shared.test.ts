import { describe, expect, it } from "vitest";

import { allianceSupportsHybridAshedPane } from "@/lib/nav/hybrid-ashed-pane.shared";

describe("allianceSupportsHybridAshedPane", () => {
  it("allows hybrid when Ashed alliance id is present", () => {
    expect(allianceSupportsHybridAshedPane("ashed-abc")).toBe(true);
  });

  it("forces native-only when Ashed alliance id is missing or blank", () => {
    expect(allianceSupportsHybridAshedPane(null)).toBe(false);
    expect(allianceSupportsHybridAshedPane(undefined)).toBe(false);
    expect(allianceSupportsHybridAshedPane("")).toBe(false);
    expect(allianceSupportsHybridAshedPane("   ")).toBe(false);
  });
});
