import { describe, expect, it } from "vitest";

import { normalizeShareCode } from "@/lib/trains/rules/template-share.server";

describe("normalizeShareCode", () => {
  it("uppercases and strips everything that is not a code character", () => {
    // Codes get retyped out of Discord, so spaces, dashes, and case drift.
    expect(normalizeShareCode(" abcd-efg hj ")).toBe("ABCDEFGHJ");
    expect(normalizeShareCode("ABCD EFG HJ")).toBe("ABCDEFGHJ");
  });

  it("is idempotent", () => {
    const once = normalizeShareCode(" k9m-2p4 ");
    expect(normalizeShareCode(once)).toBe(once);
  });

  it("returns empty for a code with no usable characters", () => {
    expect(normalizeShareCode("  --  ")).toBe("");
  });
});
