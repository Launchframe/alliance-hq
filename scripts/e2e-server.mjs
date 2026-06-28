import { execSync, spawn } from "node:child_process";
import fs from "node:fs";

import { config as loadEnv } from "dotenv";

import {
  AUTOGEN_MARKER,
  ENV_LOCAL,
  backupEnvFile,
  restoreEnvFile,
} from "./e2e-env-file.mjs";
import { assertE2eDatabaseUrl } from "./e2e-database-url-guard.mjs";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

const port = process.env.PLAYWRIGHT_E2E_PORT ?? "5176";

function requireDatabaseUrl() {
  const candidates = [
    process.env.E2E_DATABASE_URL,
    process.env.LOCAL_DATABASE_URL,
    process.env.DATABASE_URL,
  ];
  const dbUrl = candidates.map((value) => value?.trim()).find(Boolean);
  if (!dbUrl) {
    throw new Error(
      "Set E2E_DATABASE_URL (recommended) or LOCAL_DATABASE_URL in .env / .env.local before running Playwright.",
    );
  }
  assertE2eDatabaseUrl(dbUrl);
  return dbUrl;
}

function tokenKey() {
  return process.env.TOKEN_ENCRYPTION_KEY?.trim() || "a".repeat(64);
}

function authSecret() {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 32) {
    return fromEnv;
  }
  return "e2e-test-auth-secret-min-32-characters";
}

function ocrProviderEnvLines() {
  const provider = process.env.VIDEO_OCR_PROVIDER?.trim();
  if (!provider) return [];
  return [`VIDEO_OCR_PROVIDER=${provider}`, "VIDEO_OCR_ALLOW_NONPROD=true"];
}

function prepareEnvFile(dbUrl) {
  // Park the developer's real .env.local (self-healing + idempotent) before
  // writing the generated one. The marker on line 1 lets restoreEnvFile() —
  // here or in globalTeardown — recognize and clean up the generated file.
  backupEnvFile();

  fs.writeFileSync(
    ENV_LOCAL,
    [
      `${AUTOGEN_MARKER}; restored after test run`,
      `LOCAL_DATABASE_URL=${dbUrl}`,
      `DATABASE_URL=${dbUrl}`,
      `TOKEN_ENCRYPTION_KEY=${tokenKey()}`,
      `AUTH_SECRET=${authSecret()}`,
      "HQ_ASHED_INVITE_REQUIRED=false",
      "E2E_TEST=true",
      `E2E_EMAIL_CODE=${process.env.E2E_EMAIL_CODE?.trim() || "424242"}`,
      ...ocrProviderEnvLines(),
      "",
    ].join("\n"),
  );
}

function run(command, env = process.env) {
  execSync(command, { stdio: "inherit", env });
}

function buildEnv(dbUrl) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    CI: process.env.CI ?? "",
    E2E_DATABASE_URL: dbUrl,
    LOCAL_DATABASE_URL: dbUrl,
    DATABASE_URL: dbUrl,
    TOKEN_ENCRYPTION_KEY: tokenKey(),
    AUTH_SECRET: authSecret(),
    HQ_ASHED_INVITE_REQUIRED: "false",
    E2E_TEST: "true",
    E2E_EMAIL_CODE: process.env.E2E_EMAIL_CODE?.trim() || "424242",
  };
  const provider = process.env.VIDEO_OCR_PROVIDER?.trim();
  if (provider) {
    env.VIDEO_OCR_PROVIDER = provider;
    env.VIDEO_OCR_ALLOW_NONPROD = "true";
  }
  return env;
}

const dbUrl = requireDatabaseUrl();
prepareEnvFile(dbUrl);

// Always restore the developer's .env.local, no matter how we exit: normal
// shutdown, a thrown error from a failed build/migrate, Ctrl-C, or the SIGTERM
// Playwright sends when the test run finishes. process.on("exit") runs the
// synchronous fs restore reliably for normal/throw exits; the signal handlers
// below restore explicitly because "exit" does NOT fire on a bare signal.
// restoreEnvFile() is idempotent, so running it more than once is harmless.
// (A SIGKILL of this process is uncatchable — the Playwright globalTeardown
// restore is the backstop for that, and the next run still self-heals.)
process.on("exit", restoreEnvFile);

const serverEnv = buildEnv(dbUrl);
run("npm run db:migrate", serverEnv);
run("npm run db:seed-rbac", serverEnv);
run("rm -rf .next");
run("npx next build", serverEnv);

const child = spawn("npx", ["next", "start", "-p", port], {
  stdio: "inherit",
  env: serverEnv,
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restoreEnvFile();
    child.kill(signal);
  });
}
