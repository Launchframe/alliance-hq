import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { DELETE, POST } from "./route";

function request(method: "POST" | "DELETE"): NextRequest {
  return new NextRequest("http://localhost/api/dev/test-matrix/switch", {
    method,
  });
}

describe("dev test-matrix switch route guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("POST 404s in production", async () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(request("POST"));
    expect(res.status).toBe(404);
  });

  it("DELETE 404s in production", async () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    const res = await DELETE(request("DELETE"));
    expect(res.status).toBe(404);
  });

  it("POST with an unknown account is rejected in dev", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    const req = new NextRequest(
      "http://localhost/api/dev/test-matrix/switch",
      {
        method: "POST",
        body: JSON.stringify({ email: "nobody@example.com" }),
        headers: { "content-type": "application/json" },
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
