import { describe, expect, it } from "vitest";

import { localeFromLastRankCountry, resolveUserLocale } from "./user-locale.shared";

describe("localeFromLastRankCountry", () => {
  it("maps supported countries case-insensitively", () => {
    expect(localeFromLastRankCountry("br")).toBe("pt-BR");
    expect(localeFromLastRankCountry(" PT ")).toBe("pt-BR");
    expect(localeFromLastRankCountry("ID")).toBe("id");
  });

  it("returns null for unsupported or missing countries", () => {
    expect(localeFromLastRankCountry("US")).toBeNull();
    expect(localeFromLastRankCountry(null)).toBeNull();
  });
});

describe("resolveUserLocale", () => {
  it("prefers a manual pick over LastRank", () => {
    expect(resolveUserLocale({ manual: "en-US", lastrankCountries: ["BR"] })).toEqual({
      locale: "en-US",
      source: "manual",
    });
  });

  it("falls back to the first mappable LastRank country", () => {
    expect(resolveUserLocale({ manual: null, lastrankCountries: ["US", "ID"] })).toEqual({
      locale: "id",
      source: "lastrank",
    });
  });

  it("ignores invalid manual values and defaults to English", () => {
    expect(resolveUserLocale({ manual: "fr", lastrankCountries: [] })).toEqual({
      locale: "en-US",
      source: "default",
    });
  });
});
