import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "./route";

describe("trains schedule DELETE guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s in production", async () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    const res = await DELETE(
      new Request("http://localhost/api/trains/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: "2026-06-16" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("400s when weekStart is not YYYY-MM-DD", async () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    const res = await DELETE(
      new Request("http://localhost/api/trains/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: "not-a-date" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
