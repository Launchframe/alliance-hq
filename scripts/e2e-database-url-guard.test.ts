import { describe, expect, it } from "vitest";

import { assertE2eDatabaseUrl } from "./e2e-database-url-guard.mjs";

describe("assertE2eDatabaseUrl", () => {
  it("allows database names containing e2e", () => {
    expect(() =>
      assertE2eDatabaseUrl("postgresql://localhost/alliance_hq_e2e"),
    ).not.toThrow();
    expect(() =>
      assertE2eDatabaseUrl("postgresql://localhost/E2E_TEST"),
    ).not.toThrow();
  });

  it("rejects dev/prod database names", () => {
    expect(() =>
      assertE2eDatabaseUrl("postgresql://localhost/alliance_hq_dev"),
    ).toThrow(/Refusing to run e2e against a non-e2e database \(alliance_hq_dev\)/);
  });

  it("falls back to the raw url when parsing fails", () => {
    expect(() => assertE2eDatabaseUrl("not-a-valid-url")).toThrow(
      /Refusing to run e2e against a non-e2e database \(not-a-valid-url\)/,
    );
  });

  it("reports unknown when the parsed name is empty", () => {
    expect(() =>
      assertE2eDatabaseUrl("postgresql://localhost/"),
    ).toThrow(/non-e2e database \(unknown\)/);
  });
});
