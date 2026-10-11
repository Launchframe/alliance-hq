import { assertE2eDatabaseUrl } from "./e2e-database-url-guard.mjs";
import { resolveDatabaseUrl } from "./lib/database-url.mjs";

export const E2E_DIST_DIR = ".next-e2e";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertLoopbackHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "E2E_DISCORD_FOLLOWUP_ORIGIN must be a loopback http URL.",
    );
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTNAMES.has(url.hostname) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      "E2E_DISCORD_FOLLOWUP_ORIGIN must be a loopback http URL.",
    );
  }
}

export function createE2eRuntimeEnv(source = process.env) {
  const url =
    source.E2E_DATABASE_URL?.trim() || source.LOCAL_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Set E2E_DATABASE_URL to a dedicated e2e database.");
  }
  assertE2eDatabaseUrl(url);

  const port = source.PLAYWRIGHT_E2E_PORT?.trim() || "5176";
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) {
    throw new Error("Invalid isolated E2E port.");
  }

  const suppliedBaseUrl = source.PLAYWRIGHT_BASE_URL?.trim();
  const validOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  if (suppliedBaseUrl && !validOrigins.has(suppliedBaseUrl)) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL must match the isolated loopback server.",
    );
  }
  const appOrigin = suppliedBaseUrl || `http://localhost:${port}`;

  if (source.E2E_DISCORD_FOLLOWUP_ORIGIN) {
    assertLoopbackHttpUrl(source.E2E_DISCORD_FOLLOWUP_ORIGIN);
  }
  if (
    source.VIDEO_OCR_PROVIDER &&
    !["mock", "local"].includes(source.VIDEO_OCR_PROVIDER)
  ) {
    throw new Error("Isolated E2E OCR provider must be mock or local.");
  }

  const env = {
    PATH: source.PATH ?? "",
    HOME: source.HOME ?? "",
    NODE_ENV: "production",
    CI: source.CI ?? "",
    NODE_OPTIONS: "--max-old-space-size=8192",
    DATABASE_URL: url,
    LOCAL_DATABASE_URL: url,
    E2E_DATABASE_URL: url,
    E2E_TEST: "true",
    HQ_E2E_ISOLATED: "1",
    __NEXT_PROCESSED_ENV: "true",
    TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    AUTH_SECRET: "e2e-test-auth-secret-min-32-characters",
    HQ_ASHED_INVITE_REQUIRED: "false",
    E2E_EMAIL_CODE: "424242",
    AUTH_GOOGLE_ID: "e2e-google-client-id",
    AUTH_GOOGLE_SECRET: "e2e-google-client-secret",
    AUTH_DISCORD_ID: "e2e-discord-client-id",
    AUTH_DISCORD_SECRET: "e2e-discord-client-secret",
    OCR_WORKER_SECRET: "e2e-ocr-worker-secret-not-for-production",
    LASTRANK_SYNC_TOKEN: "e2e-lastrank-sync-token-not-for-production",
    NOTES_INTAKE_TEST_PROVIDER: "true",
    NOTES_HISTORY_TEST_PROVIDER: "true",
    NOTES_KNOWLEDGE_TEST_PROVIDER: "1",
    PLAYWRIGHT_E2E_PORT: port,
    PLAYWRIGHT_BASE_URL: appOrigin,
    NEXT_PUBLIC_APP_URL: appOrigin,
    CALENDAR_APP_ORIGIN: appOrigin,
    OCR_WORKER_BASE_URL: `http://127.0.0.1:${port}`,
    ASHED_API_BASE_ORIGIN: "http://127.0.0.1:14789",
    ...(source.DISCORD_PUBLIC_KEY
      ? { DISCORD_PUBLIC_KEY: source.DISCORD_PUBLIC_KEY }
      : {}),
    ...(source.E2E_DISCORD_FOLLOWUP_ORIGIN
      ? { E2E_DISCORD_FOLLOWUP_ORIGIN: source.E2E_DISCORD_FOLLOWUP_ORIGIN }
      : {}),
    ...(source.VIDEO_OCR_PROVIDER
      ? {
          VIDEO_OCR_PROVIDER: source.VIDEO_OCR_PROVIDER,
          VIDEO_OCR_ALLOW_NONPROD: "true",
        }
      : {}),
  };
  assertE2eDatabaseUrl(resolveDatabaseUrl(env));
  return env;
}
