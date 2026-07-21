import { describe, expect, it, vi } from "vitest";

import {
  collectDatabaseErrorText,
  isConnectionPoolExhausted,
  isDatabaseErrorTextLeakedToClient,
  isEncryptionKeyError,
  isMissingSchemaError,
  postgresErrorCode,
  publicPairingCompleteFailureMessage,
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

describe("publicPairingCompleteFailureMessage", () => {
  it("hides Drizzle SQL and postgres codes from clients", () => {
    const pg = Object.assign(
      new Error('duplicate key value violates unique constraint "linked_devices_session_id_key"'),
      { code: "23505" },
    );
    const drizzle = new Error('Failed query: insert into "linked_devices"', {
      cause: pg,
    });

    expect(isDatabaseErrorTextLeakedToClient(drizzle)).toBe(true);
    expect(publicPairingCompleteFailureMessage(drizzle)).toBe(
      "Pairing failed. Generate a new QR code and try again.",
    );
  });

  it("does not pass through arbitrary internal error messages", () => {
    expect(
      publicPairingCompleteFailureMessage(
        new Error("ENOENT: /var/task/secrets/token.key"),
      ),
    ).toBe("Pairing failed.");
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
