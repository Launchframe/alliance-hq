import { describe, expect, it, vi } from "vitest";

import {
  collectDatabaseErrorText,
  isConnectionPoolExhausted,
  isEncryptionKeyError,
  isMissingSchemaError,
  isPostgresAuthError,
  postgresErrorCode,
  resolveDatabaseErrorPresentation,
} from "./error-message";

describe("collectDatabaseErrorText", () => {
  it("includes nested postgres cause messages and codes", () => {
    const pg = Object.assign(new Error("sorry, too many clients already"), {
      code: "53300",
    });
    const drizzle = new Error("Failed query: select 1", { cause: pg });

    expect(collectDatabaseErrorText(drizzle)).toContain("Failed query");
    expect(collectDatabaseErrorText(drizzle)).toContain("too many clients already");
    expect(collectDatabaseErrorText(drizzle)).toContain("postgres:53300");
    expect(postgresErrorCode(drizzle)).toBe("53300");
  });
});

describe("isConnectionPoolExhausted", () => {
  it("detects 53300 in wrapped errors", () => {
    const pg = Object.assign(new Error("sorry, too many clients already"), {
      code: "53300",
    });
    expect(isConnectionPoolExhausted(new Error("Failed query", { cause: pg }))).toBe(
      true,
    );
  });
});

describe("isMissingSchemaError", () => {
  it("detects missing column messages", () => {
    expect(
      isMissingSchemaError(
        new Error('column "timezone" of relation "hq_users" does not exist'),
      ),
    ).toBe(true);
  });
});

describe("isEncryptionKeyError", () => {
  it("detects auth tag failures from key mismatch", () => {
    expect(
      isEncryptionKeyError(
        new Error("Unsupported state or unable to authenticate data"),
      ),
    ).toBe(true);
  });
});

describe("isPostgresAuthError", () => {
  it("detects 28P01 in wrapped errors", () => {
    const pg = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    });
    expect(isPostgresAuthError(new Error("Failed query", { cause: pg }))).toBe(true);
    expect(isPostgresAuthError(new Error("too many clients"))).toBe(false);
  });
});

describe("resolveDatabaseErrorPresentation", () => {
  it("maps production unknown errors away from local dev defaultHint", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(
        resolveDatabaseErrorPresentation(
          new Error('column "timezone" of relation "hq_users" does not exist'),
        ),
      ).toEqual({
        titleKey: "serviceUnavailable",
        hintKey: "schemaMigrationHint",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
