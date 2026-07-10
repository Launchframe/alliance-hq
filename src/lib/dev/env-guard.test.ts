import { afterEach, describe, expect, it, vi } from "vitest";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";

describe("isDevOrPreviewEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled on Vercel production", () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(false);
  });

  it("is enabled on Vercel preview", () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is enabled on Vercel development", () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is enabled in local dev (no VERCEL_ENV)", () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is disabled in a local production build", () => {
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(false);
  });

  it("is enabled under E2E_TEST even for production builds", () => {
    vi.stubEnv("E2E_TEST", "true");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("is disabled on Vercel production even when E2E_TEST is set", () => {
    vi.stubEnv("E2E_TEST", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevOrPreviewEnvironment()).toBe(false);
  });
});

describe("isUidBypassEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("matches pre-production environments", async () => {
    const { isUidBypassEnabled } = await import("@/lib/dev/env-guard");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST", "");
    expect(isUidBypassEnabled()).toBe(true);
  });

  it("is disabled on Vercel production", async () => {
    const { isUidBypassEnabled } = await import("@/lib/dev/env-guard");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST", "");
    expect(isUidBypassEnabled()).toBe(false);
  });
});
