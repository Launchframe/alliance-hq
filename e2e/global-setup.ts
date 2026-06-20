import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const envLocal = path.join(process.cwd(), ".env.local");
const envBackup = path.join(process.cwd(), ".env.local.e2e-bak");

export default async function globalSetup() {
  const dbUrl =
    process.env.E2E_DATABASE_URL?.trim() ||
    process.env.LOCAL_DATABASE_URL?.trim();

  if (!dbUrl) {
    throw new Error(
      "Set E2E_DATABASE_URL (recommended) or LOCAL_DATABASE_URL before running Playwright.",
    );
  }

  const tokenKey =
    process.env.TOKEN_ENCRYPTION_KEY?.trim() || "a".repeat(64);

  process.env.E2E_DATABASE_URL = dbUrl;
  process.env.LOCAL_DATABASE_URL = dbUrl;
  process.env.DATABASE_URL = dbUrl;
  process.env.TOKEN_ENCRYPTION_KEY = tokenKey;
  process.env.HQ_ASHED_INVITE_REQUIRED = "false";

  if (fs.existsSync(envBackup)) {
    fs.unlinkSync(envBackup);
  }

  if (fs.existsSync(envLocal)) {
    fs.renameSync(envLocal, envBackup);
  }

  fs.writeFileSync(
    envLocal,
    [
      `# Playwright E2E — auto-generated; restored after test run`,
      `LOCAL_DATABASE_URL=${dbUrl}`,
      `DATABASE_URL=${dbUrl}`,
      `TOKEN_ENCRYPTION_KEY=${tokenKey}`,
      `HQ_ASHED_INVITE_REQUIRED=false`,
      "",
    ].join("\n"),
  );

  execSync("npm run db:migrate", {
    stdio: "inherit",
    env: {
      ...process.env,
      LOCAL_DATABASE_URL: dbUrl,
      DATABASE_URL: dbUrl,
    },
  });
  execSync("npm run db:seed-rbac", {
    stdio: "inherit",
    env: {
      ...process.env,
      LOCAL_DATABASE_URL: dbUrl,
      DATABASE_URL: dbUrl,
    },
  });
  execSync("rm -rf .next", { stdio: "inherit" });
  execSync("npx next build", {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      LOCAL_DATABASE_URL: dbUrl,
      DATABASE_URL: dbUrl,
      TOKEN_ENCRYPTION_KEY: tokenKey,
      HQ_ASHED_INVITE_REQUIRED: "false",
    },
  });
}
