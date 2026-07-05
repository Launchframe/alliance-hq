import { describe, expect, it } from "vitest";

import {
  postgresSqlState,
  trackDatabaseHealthFailure,
  trackVercelCustomEvent,
} from "./vercel-observability";

describe("postgresSqlState", () => {
  it("returns SQLSTATE from postgres.js errors", () => {
    expect(postgresSqlState({ code: "28P01" })).toBe("28P01");
  });

  it("returns null for non-object or missing code", () => {
    expect(postgresSqlState(null)).toBeNull();
    expect(postgresSqlState(new Error("fail"))).toBeNull();
  });
});

describe("trackVercelCustomEvent", () => {
  it("no-ops outside Vercel production", async () => {
    await expect(
      trackVercelCustomEvent("Test Event", { ok: true }),
    ).resolves.toBeUndefined();
    await expect(trackDatabaseHealthFailure({ code: "28P01" })).resolves.toBeUndefined();
  });
});
