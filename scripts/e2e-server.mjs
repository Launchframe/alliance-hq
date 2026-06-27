import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

const port = process.env.PLAYWRIGHT_E2E_PORT ?? "5176";
const envLocal = path.join(process.cwd(), ".env.local");
const envBackup = path.join(process.cwd(), ".env.local.e2e-bak");

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

// Tracks whether prepareEnvFile() ran so restoreEnvFile() only acts when needed.
let envPrepared = false;
// Tracks whether the developer had a real .env.local that we moved aside.
let hadOriginalEnv = false;

function prepareEnvFile(dbUrl) {
  // Self-heal: a stale backup means a previous run was killed before it could
  // restore. Treat the backup as the real file and the current .env.local as a
  // generated leftover, so we recover the developer's file instead of losing it.
  if (fs.existsSync(envBackup)) {
    if (fs.existsSync(envLocal)) {
      fs.unlinkSync(envLocal);
    }
    fs.renameSync(envBackup, envLocal);
  }

  hadOriginalEnv = fs.existsSync(envLocal);
  if (hadOriginalEnv) {
    fs.renameSync(envLocal, envBackup);
  }
  envPrepared = true;

  fs.writeFileSync(
    envLocal,
    [
      "# Playwright E2E — auto-generated; restored after test run",
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

function restoreEnvFile() {
  if (!envPrepared) return;
  envPrepared = false;
  try {
    // Drop the auto-generated file...
    if (fs.existsSync(envLocal)) {
      fs.unlinkSync(envLocal);
    }
    // ...and put the developer's real .env.local back (if there was one).
    if (hadOriginalEnv && fs.existsSync(envBackup)) {
      fs.renameSync(envBackup, envLocal);
    }
  } catch (err) {
    console.error(
      `Failed to restore .env.local; your original is preserved at ${envBackup}`,
      err,
    );
  }
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
// Playwright sends when the test run finishes. process.on("exit") fires for all
// of these and runs synchronous fs work reliably.
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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
