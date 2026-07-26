// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { postgresErrorResponse } from "./api-error";

describe("postgresErrorResponse", () => {
  it("maps unique violation to 409", async () => {
    const err = Object.assign(new Error("duplicate"), { code: "23505" });
    const res = postgresErrorResponse(err);
    expect(res?.status).toBe(409);
    expect(await res?.json()).toMatchObject({ code: "23505" });
  });

  it("maps FK violation to 409", async () => {
    const err = Object.assign(new Error("fk"), { code: "23503" });
    const res = postgresErrorResponse(err);
    expect(res?.status).toBe(409);
  });

  it("maps missing relation to schema_drift 500", async () => {
    const err = new Error('relation "ops_events" does not exist');
    const res = postgresErrorResponse(err);
    expect(res?.status).toBe(500);
    expect(await res?.json()).toMatchObject({ code: "schema_drift" });
  });

  it("returns null for unknown errors", () => {
    expect(postgresErrorResponse(new Error("boom"))).toBeNull();
  });
});
