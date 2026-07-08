import { config as loadEnv } from "dotenv";
import { defineConfig } from "@playwright/test";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL?.trim() ||
  process.env.LOCAL_DATABASE_URL?.trim() ||
  "";
const tokenEncryptionKey =
  process.env.TOKEN_ENCRYPTION_KEY?.trim() || "a".repeat(64);
const authSecret =
  process.env.AUTH_SECRET?.trim() ||
  "e2e-test-auth-secret-min-32-characters";

// Test workers import app crypto helpers directly — not only the webServer env.
process.env.TOKEN_ENCRYPTION_KEY = tokenEncryptionKey;

/** Minimal env for Next — avoid libpq PG* vars from the developer shell. */
function e2eServerEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    CI: process.env.CI ?? "",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=8192"]
      .filter(Boolean)
      .join(" "),
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    AUTH_SECRET: authSecret,
    HQ_ASHED_INVITE_REQUIRED: "false",
    E2E_TEST: "true",
    E2E_EMAIL_CODE: process.env.E2E_EMAIL_CODE?.trim() || "424242",
  };
  if (e2eDatabaseUrl) {
    env.E2E_DATABASE_URL = e2eDatabaseUrl;
    env.LOCAL_DATABASE_URL = e2eDatabaseUrl;
    env.DATABASE_URL = e2eDatabaseUrl;
  }
  const ocrProvider = process.env.VIDEO_OCR_PROVIDER?.trim();
  if (ocrProvider) {
    env.VIDEO_OCR_PROVIDER = ocrProvider;
    env.VIDEO_OCR_ALLOW_NONPROD = "true";
  }
  return env;
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
