import { describe, expect, it } from "vitest";

import {
  decideGeoLocaleRedirect,
  localeFromVercelCountry,
  withLocalePrefix,
} from "./geo-locale.shared";

describe("localeFromVercelCountry", () => {
  it("maps Brazil and Portugal to pt-BR", () => {
    expect(localeFromVercelCountry("BR")).toBe("pt-BR");
    expect(localeFromVercelCountry("br")).toBe("pt-BR");
    expect(localeFromVercelCountry(" PT ")).toBe("pt-BR");
  });

  it("returns null for other or missing countries", () => {
    expect(localeFromVercelCountry(null)).toBeNull();
    expect(localeFromVercelCountry("")).toBeNull();
    expect(localeFromVercelCountry("US")).toBeNull();
    expect(localeFromVercelCountry("DE")).toBeNull();
  });
});

describe("withLocalePrefix", () => {
  it("prefixes pt-BR paths and leaves en-US unprefixed", () => {
    expect(withLocalePrefix("/", "pt-BR")).toBe("/pt-BR");
    expect(withLocalePrefix("/invite/abc", "pt-BR")).toBe("/pt-BR/invite/abc");
    expect(withLocalePrefix("/invite/abc", "en-US")).toBe("/invite/abc");
  });

  it("does not double-prefix", () => {
    expect(withLocalePrefix("/pt-BR/invite/abc", "pt-BR")).toBe(
      "/pt-BR/invite/abc",
    );
  });
});

describe("decideGeoLocaleRedirect", () => {
  it("passthrough when the path is already prefixed", () => {
    expect(
      decideGeoLocaleRedirect({
        pathname: "/pt-BR/invite/x",
        localeCookie: undefined,
        vercelCountry: "BR",
      }),
    ).toEqual({ action: "passthrough" });
  });

  it("passthrough when the user already has a locale cookie", () => {
    expect(
      decideGeoLocaleRedirect({
        pathname: "/invite/x",
        localeCookie: "en-US",
        vercelCountry: "BR",
      }),
    ).toEqual({ action: "passthrough" });
  });

  it("redirects unprefixed first visits from Brazil to pt-BR", () => {
    expect(
      decideGeoLocaleRedirect({
        pathname: "/invite/tok",
        localeCookie: undefined,
        vercelCountry: "BR",
      }),
    ).toEqual({
      action: "redirect",
      locale: "pt-BR",
      pathname: "/pt-BR/invite/tok",
    });
  });

  it("passthrough when geo is missing or not Portuguese-speaking", () => {
    expect(
      decideGeoLocaleRedirect({
        pathname: "/",
        localeCookie: undefined,
        vercelCountry: "US",
      }),
    ).toEqual({ action: "passthrough" });
  });
});
