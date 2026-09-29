import { config as loadEnv } from "dotenv";
import { defineConfig } from "@playwright/test";
import { discordTestFollowupPort, discordTestKeyPair } from "./e2e/fixtures/discord-signing";
import { createE2eProjects } from "./scripts/e2e-projects.mjs";
import { createE2eRuntimeEnv } from "./scripts/e2e-runtime.mjs";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

const runtimeEnv = createE2eRuntimeEnv(process.env);
const baseURL = runtimeEnv.PLAYWRIGHT_BASE_URL;

// Test workers import app crypto helpers directly — not only the webServer env.
process.env.DATABASE_URL = runtimeEnv.DATABASE_URL;
process.env.LOCAL_DATABASE_URL = runtimeEnv.LOCAL_DATABASE_URL;
process.env.E2E_DATABASE_URL = runtimeEnv.E2E_DATABASE_URL;
process.env.TOKEN_ENCRYPTION_KEY = runtimeEnv.TOKEN_ENCRYPTION_KEY;
process.env.AUTH_SECRET = runtimeEnv.AUTH_SECRET;
process.env.E2E_TEST = runtimeEnv.E2E_TEST;
process.env.HQ_E2E_ISOLATED = runtimeEnv.HQ_E2E_ISOLATED;
process.env.__NEXT_PROCESSED_ENV = runtimeEnv.__NEXT_PROCESSED_ENV;
process.env.E2E_EMAIL_CODE = runtimeEnv.E2E_EMAIL_CODE;
process.env.PLAYWRIGHT_BASE_URL = runtimeEnv.PLAYWRIGHT_BASE_URL;
process.env.NOTES_INTAKE_TEST_PROVIDER = runtimeEnv.NOTES_INTAKE_TEST_PROVIDER;
process.env.NOTES_HISTORY_TEST_PROVIDER =
  runtimeEnv.NOTES_HISTORY_TEST_PROVIDER;
process.env.NOTES_KNOWLEDGE_TEST_PROVIDER =
  runtimeEnv.NOTES_KNOWLEDGE_TEST_PROVIDER;

/** Minimal env for Next — avoid libpq PG* vars from the developer shell. */
function e2eServerEnv(): Record<string, string> {
  return {
    ...runtimeEnv,
    DISCORD_PUBLIC_KEY: Buffer.from(discordTestKeyPair.publicKey).toString("hex"),
    E2E_DISCORD_FOLLOWUP_ORIGIN: `http://127.0.0.1:${discordTestFollowupPort()}`,
  };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 2,
  projects: createE2eProjects(),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/e2e-server-isolated.mjs",
    url: `${baseURL}/api/auth/connect`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: e2eServerEnv(),
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown-isolated.ts",
});
