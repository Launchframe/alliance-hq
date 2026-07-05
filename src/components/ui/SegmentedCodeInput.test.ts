import { describe, expect, it } from "vitest";

import {
  normalizeJoinCodeInput,
  splitJoinCodeInput,
} from "@/components/ui/SegmentedCodeInput";

describe("splitJoinCodeInput", () => {
  it("splits tag and suffix at the first hyphen", () => {
    expect(splitJoinCodeInput("LFgo-A1B2C3")).toEqual({
      prefix: "LFgo",
      suffix: "A1B2C3",
      hasHyphen: true,
    });
  });

  it("keeps partial prefix before hyphen is typed", () => {
    expect(splitJoinCodeInput("LFgo")).toEqual({
      prefix: "LFgo",
      suffix: "",
      hasHyphen: false,
    });
  });
});

describe("normalizeJoinCodeInput", () => {
  it("uppercases and strips invalid characters", () => {
    expect(normalizeJoinCodeInput("lfgo-a1b2")).toBe("LFGO-A1B2");
  });

  it("limits prefix and suffix lengths separately", () => {
    expect(normalizeJoinCodeInput("12345678901-ABCDEFGH")).toBe(
      "1234567890-ABCDEF",
    );
  });
});
