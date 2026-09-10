import { spawn } from "node:child_process";
import { createServer } from "node:net";
import postgres from "postgres";
import { assertE2eDatabaseUrl } from "./e2e-database-url-guard.mjs";
import { resolveDatabaseUrl } from "./lib/database-url.mjs";

const url = process.env.CALENDAR_TEST_DATABASE_URL;
if (!url) throw new Error("CALENDAR_TEST_DATABASE_URL is required");
assertE2eDatabaseUrl(url);
const parsed = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^\/alliance_hq_calendar_e2e_[a-z0-9_]+$/.test(parsed.pathname)) throw new Error("Calendar verification requires its own local database");
const client = postgres(url, { max: 1, prepare: false });
const [{ acquired, database }] = await client`select pg_try_advisory_lock(hashtextextended('calendar-verification', 0)) as acquired, current_database() as database`;
if (!acquired || database !== parsed.pathname.slice(1)) { await client.end(); throw new Error("Test database is not exclusively owned"); }
const env = { PATH: process.env.PATH, HOME: process.env.HOME, __NEXT_PROCESSED_ENV: "true", NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=8192", DATABASE_URL: url, LOCAL_DATABASE_URL: url, E2E_DATABASE_URL: url, CALENDAR_DB_TEST: "1", E2E_TEST: "true", E2E_EMAIL_CODE: "424242", HQ_ASHED_INVITE_REQUIRED: "false", TOKEN_ENCRYPTION_KEY: "a".repeat(64), AUTH_SECRET: "calendar-e2e-only-auth-secret-32-characters", AUTH_GOOGLE_ID: "e2e-google-client-id", AUTH_GOOGLE_SECRET: "e2e-google-client-secret", AUTH_DISCORD_ID: "e2e-discord-client-id", AUTH_DISCORD_SECRET: "e2e-discord-client-secret", CALENDAR_GOOGLE_TRANSPORT: "disabled", VIDEO_WORKER_SECRET: "", VIDEO_WORKER_BASE_URL: "", DISCORD_BOT_TOKEN: "", CRON_SECRET: "" };
if (resolveDatabaseUrl(env) !== url) throw new Error("Effective test database differs");
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Verification exited ${code}`)));
});
let server;
try {
  const mode = process.argv[2];
  if (mode === "migrate") {
    await run(["scripts/db-migrate.mjs"]); await run(["scripts/rbac/seed.mjs"]);
  } else if (mode === "build") {
    await run(["scripts/db-migrate.mjs"]); await run(["scripts/db-seed.mjs"]); await run(["node_modules/next/dist/bin/next", "build"]);
  } else if (mode === "test") {
    env.NODE_ENV = "test"; await run(["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(3)]);
  } else if (mode === "e2e") {
    const reservation = createServer(); await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
    env.PLAYWRIGHT_BASE_URL = `http://localhost:${port}`; env.PLAYWRIGHT_E2E_PORT = String(port); env.NEXT_PUBLIC_APP_URL = env.PLAYWRIGHT_BASE_URL; env.CALENDAR_APP_ORIGIN = env.PLAYWRIGHT_BASE_URL;
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "localhost"], { env, stdio: "inherit" });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error("Owned test server exited");
      try { const response = await fetch(`${env.PLAYWRIGHT_BASE_URL}/api/auth/connect`); if (response.status < 500) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error("Owned test server did not become ready");
    await run(["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(3)]);
  } else throw new Error("Choose migrate, build, test or e2e");
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const ended = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    const deadline = setTimeout(() => server.kill("SIGKILL"), 10_000);
    deadline.unref();
    await ended;
    clearTimeout(deadline);
  }
  await client.end({ timeout: 5 });
}
