import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("vs-fixture API gating", () => {
  const origVercelEnv = process.env.VERCEL_ENV;
  const origNodeEnv = process.env.NODE_ENV;
  const origE2eTest = process.env.E2E_TEST;

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.E2E_TEST;
  });

  afterEach(() => {
    process.env.VERCEL_ENV = origVercelEnv;
    (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
    process.env.E2E_TEST = origE2eTest;
  });

  it("isDevOrPreviewEnvironment returns false for production", async () => {
    process.env.VERCEL_ENV = "production";
    const { isDevOrPreviewEnvironment } = await import(
      "@/lib/dev/env-guard"
    );
    expect(isDevOrPreviewEnvironment()).toBe(false);
  });

  it("isDevOrPreviewEnvironment returns true for preview", async () => {
    process.env.VERCEL_ENV = "preview";
    vi.resetModules();
    const { isDevOrPreviewEnvironment } = await import(
      "@/lib/dev/env-guard"
    );
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });

  it("isDevOrPreviewEnvironment returns true for e2e test", async () => {
    process.env.E2E_TEST = "true";
    vi.resetModules();
    const { isDevOrPreviewEnvironment } = await import(
      "@/lib/dev/env-guard"
    );
    expect(isDevOrPreviewEnvironment()).toBe(true);
  });
});
