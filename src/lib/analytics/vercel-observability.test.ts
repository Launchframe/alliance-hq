import { afterEach, describe, expect, it, vi } from "vitest";

const trackMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/analytics/server", () => ({
  track: trackMock,
}));

import {
  postgresSqlState,
  trackDatabaseHealthFailure,
  trackVercelCustomEvent,
} from "./vercel-observability";

describe("postgresSqlState", () => {
  it("returns SQLSTATE from postgres.js errors", () => {
    expect(postgresSqlState({ code: "28P01" })).toBe("28P01");
  });

  it("returns SQLSTATE from Drizzle-wrapped postgres errors", () => {
    const pg = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    });
    const drizzle = new Error("Failed query: select 1", { cause: pg });

    expect(postgresSqlState(drizzle)).toBe("28P01");
  });

  it("returns null for non-object or missing code", () => {
    expect(postgresSqlState(null)).toBeNull();
    expect(postgresSqlState(new Error("fail"))).toBeNull();
  });
});

describe("trackVercelCustomEvent", () => {
  afterEach(() => {
    trackMock.mockClear();
    vi.unstubAllEnvs();
  });

  it("no-ops outside Vercel production", async () => {
    await expect(
      trackVercelCustomEvent("Test Event", { ok: true }),
    ).resolves.toBeUndefined();
    await expect(trackDatabaseHealthFailure({ code: "28P01" })).resolves.toBeUndefined();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("calls Vercel track in production on Vercel", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");

    await trackDatabaseHealthFailure({ code: "53300" });

    expect(trackMock).toHaveBeenCalledWith("DB Health Check Failed", {
      sqlState: "53300",
    });
  });

  it("falls back to unknown sqlState when code is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");

    await trackDatabaseHealthFailure(new Error("connection refused"));

    expect(trackMock).toHaveBeenCalledWith("DB Health Check Failed", {
      sqlState: "unknown",
    });
  });
});
