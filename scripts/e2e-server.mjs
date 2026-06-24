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

function prepareEnvFile(dbUrl) {
  if (fs.existsSync(envBackup)) {
    fs.unlinkSync(envBackup);
  }
  if (fs.existsSync(envLocal)) {
    fs.renameSync(envLocal, envBackup);
  }
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
      "",
    ].join("\n"),
  );
}

function run(command, env = process.env) {
  execSync(command, { stdio: "inherit", env });
}

function buildEnv(dbUrl) {
  return {
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
}

const dbUrl = requireDatabaseUrl();
prepareEnvFile(dbUrl);

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
