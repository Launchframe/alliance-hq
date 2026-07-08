import postgres from "postgres";

import { getDatabaseUrl } from "./url";

/** True on Vercel and other production Node runtimes — one pool slot per instance. */
export function isServerlessPostgresRuntime(): boolean {
  if (process.env.E2E_TEST === "true") {
    return false;
  }
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

export function postgresClientOptions(): NonNullable<Parameters<typeof postgres>[1]> {
  const serverless = isServerlessPostgresRuntime();
  return {
    prepare: false,
    max: serverless ? 1 : 5,
    idle_timeout: serverless ? 20 : 0,
    max_lifetime: serverless ? 60 * 10 : 60 * 60,
    connect_timeout: 10,
  };
}

let sqlClient: ReturnType<typeof postgres> | null = null;

/** Shared postgres.js pool — use for queries, drizzle, and pg_notify (not LISTEN/SSE). */
export function getSqlClient(): ReturnType<typeof postgres> {
  if (!sqlClient) {
    sqlClient = postgres(getDatabaseUrl(), postgresClientOptions());
  }
  return sqlClient;
}
