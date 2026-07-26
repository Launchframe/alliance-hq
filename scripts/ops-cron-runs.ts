#!/usr/bin/env npx tsx
/**
 * Print recent cron_runs rows from Postgres.
 * Usage: npm run ops:crons -- --name=season-sync
 *
 * Loads LOCAL_DATABASE_URL / DATABASE_URL from .env.local via dotenv (never prints the URL).
 */

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config();

async function main() {
  const url =
    process.env.LOCAL_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Set LOCAL_DATABASE_URL or DATABASE_URL");
    process.exit(1);
  }

  const nameArg = process.argv.find((a) => a.startsWith("--name="));
  const name = nameArg?.split("=")[1];

  const sql = postgres(url, { max: 1 });
  try {
    const runs = name
      ? await sql`
          select started_at, name, status, duration_ms, error_class, error_message
          from cron_runs
          where name = ${name}
          order by started_at desc
          limit 20
        `
      : await sql`
          select started_at, name, status, duration_ms, error_class, error_message
          from cron_runs
          order by started_at desc
          limit 30
        `;

    if (runs.length === 0) {
      console.log("No cron runs found.");
      return;
    }

    for (const run of runs) {
      const startedAt =
        run.started_at instanceof Date
          ? run.started_at.toISOString()
          : String(run.started_at);
      console.log(
        `${startedAt}  ${run.name}  ${run.status}  ${run.duration_ms ?? "—"}ms  ${run.error_class ?? ""}`,
      );
      if (run.error_message) console.log(`  ${run.error_message}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
