import { describe, expect, it } from "vitest";

import {
  countryDisplayName,
  countryFlagParts,
  isoCountryFlagEmoji,
  normalizeIsoCountryCode,
} from "@/lib/members/country-flag.shared";

describe("normalizeIsoCountryCode", () => {
  it("uppercases two-letter codes", () => {
    expect(normalizeIsoCountryCode(" us ")).toBe("US");
  });

  it("maps UK to GB", () => {
    expect(normalizeIsoCountryCode("uk")).toBe("GB");
  });

  it("rejects empty and non-ISO values", () => {
    expect(normalizeIsoCountryCode(null)).toBeNull();
    expect(normalizeIsoCountryCode("")).toBeNull();
    expect(normalizeIsoCountryCode("USA")).toBeNull();
    expect(normalizeIsoCountryCode("United States")).toBeNull();
  });
});

describe("isoCountryFlagEmoji", () => {
  it("builds regional-indicator pairs", () => {
    expect(isoCountryFlagEmoji("US")).toBe("🇺🇸");
  });
});

describe("countryDisplayName", () => {
  it("returns a localized region name", () => {
    expect(countryDisplayName("US", "en-US")).toBe("United States");
    expect(countryDisplayName("BR", "pt-BR")).toMatch(/Brasil/i);
  });
});

describe("countryFlagParts", () => {
  it("returns emoji and accessible name when the code is a real region", () => {
    expect(countryFlagParts("us", "en-US")).toEqual({
      code: "US",
      emoji: "🇺🇸",
      name: "United States",
    });
  });

  it("returns null when country is missing", () => {
    expect(countryFlagParts(null, "en-US")).toBeNull();
  });
});
