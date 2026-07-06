import { describe, expect, it } from "vitest";

import {
  normalizeFixedCodeInput,
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

  it("handles short alliance tags without padding", () => {
    expect(splitJoinCodeInput("ABC-DEF123")).toEqual({
      prefix: "ABC",
      suffix: "DEF123",
      hasHyphen: true,
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

describe("normalizeFixedCodeInput", () => {
  it("keeps only digits for numeric codes", () => {
    expect(normalizeFixedCodeInput("12a3b4", 6, "numeric")).toBe("1234");
  });

  it("limits to the configured length", () => {
    expect(normalizeFixedCodeInput("1234567890", 6, "numeric")).toBe("123456");
  });

  it("uppercases alphanumeric codes", () => {
    expect(normalizeFixedCodeInput("ab12cd", 6, "alphanumeric")).toBe("AB12CD");
  });
});
