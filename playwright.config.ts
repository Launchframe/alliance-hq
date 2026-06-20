import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL?.trim() ||
  process.env.LOCAL_DATABASE_URL?.trim() ||
  "";
const tokenEncryptionKey =
  process.env.TOKEN_ENCRYPTION_KEY?.trim() || "a".repeat(64);

/** Minimal env for Next — avoid libpq PG* vars from the developer shell. */
function e2eServerEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    CI: process.env.CI ?? "",
    E2E_DATABASE_URL: e2eDatabaseUrl,
    LOCAL_DATABASE_URL: e2eDatabaseUrl,
    DATABASE_URL: e2eDatabaseUrl,
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    HQ_ASHED_INVITE_REQUIRED: "false",
  };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${baseURL}/api/auth/connect`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: e2eServerEnv(),
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
});
