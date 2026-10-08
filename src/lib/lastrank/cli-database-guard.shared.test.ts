import { describe, expect, it } from "vitest";

import {
  assertCliDatabaseHostConfirmed,
  isLocalDatabaseHost,
} from "@/lib/lastrank/cli-database-guard.shared";

const NEON = "ep-orange-wildflower-adaa7e6k-pooler.c-2.us-east-1.aws.neon.tech";

describe("isLocalDatabaseHost", () => {
  it("recognizes loopback hosts", () => {
    expect(isLocalDatabaseHost("localhost")).toBe(true);
    expect(isLocalDatabaseHost("127.0.0.1")).toBe(true);
    expect(isLocalDatabaseHost("::1")).toBe(true);
    expect(isLocalDatabaseHost(NEON)).toBe(false);
  });
});

describe("assertCliDatabaseHostConfirmed", () => {
  it("allows local writes without confirmation", () => {
    expect(() =>
      assertCliDatabaseHostConfirmed({ host: "localhost", writes: true }),
    ).not.toThrow();
  });

  it("allows remote dry-runs without confirmation", () => {
    expect(() =>
      assertCliDatabaseHostConfirmed({ host: NEON, writes: false }),
    ).not.toThrow();
  });

  it("refuses remote writes without confirmation", () => {
    expect(() =>
      assertCliDatabaseHostConfirmed({ host: NEON, writes: true }),
    ).toThrow(/--confirm-host/);
  });

  it("allows remote writes when the host matches (case-insensitive)", () => {
    expect(() =>
      assertCliDatabaseHostConfirmed({
        host: NEON,
        writes: true,
        confirmHost: NEON.toUpperCase(),
      }),
    ).not.toThrow();
  });

  it("rejects a mismatched confirmation even on local or dry-run", () => {
    expect(() =>
      assertCliDatabaseHostConfirmed({
        host: "localhost",
        writes: false,
        confirmHost: NEON,
      }),
    ).toThrow(/does not match/);
  });
});
