import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";

describe("isDevOrPreviewEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled on Vercel production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(false);
  });

  it("is enabled on Vercel preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is enabled on Vercel development", () => {
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is enabled in local dev (no VERCEL_ENV)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is disabled in a local production build", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(false);
  });
});
