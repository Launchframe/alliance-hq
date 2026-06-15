import { afterEach, describe, expect, it } from "vitest";

import { resolveAppOrigin } from "@/lib/app-origin";

describe("resolveAppOrigin", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("prefers NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://alliance-hq.vercel.app/";
    delete process.env.VERCEL_URL;
    expect(resolveAppOrigin()).toBe("https://alliance-hq.vercel.app");
  });

  it("falls back to VERCEL_URL", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "preview.example.vercel.app";
    expect(resolveAppOrigin()).toBe("https://preview.example.vercel.app");
  });

  it("defaults to local dev origin", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    expect(resolveAppOrigin()).toBe("http://localhost:5175");
  });
});
