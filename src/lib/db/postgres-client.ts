import postgres from "postgres";

import { isPostgresAuthError } from "./error-message";
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
let sqlClientUrl: string | null = null;

/** Drop the module singleton so the next getSqlClient() re-reads DATABASE_URL. */
export async function resetSqlClient(): Promise<void> {
  if (!sqlClient) {
    sqlClientUrl = null;
    return;
  }
  const client = sqlClient;
  sqlClient = null;
  sqlClientUrl = null;
  await client.end({ timeout: 0 }).catch(() => undefined);
}

/**
 * Shared postgres.js pool — use for queries, drizzle, and pg_notify (not LISTEN/SSE).
 * Recreates the client when DATABASE_URL changes (Neon ↔ Vercel integration sync).
 */
export function getSqlClient(): ReturnType<typeof postgres> {
  const url = getDatabaseUrl();
  if (sqlClient && sqlClientUrl !== url) {
    const stale = sqlClient;
    sqlClient = null;
    sqlClientUrl = null;
    void stale.end({ timeout: 0 }).catch(() => undefined);
  }
  if (!sqlClient) {
    sqlClientUrl = url;
    sqlClient = postgres(url, postgresClientOptions());
  }
  return sqlClient;
}

/**
 * Retry once after resetting the pool when Neon credential rotation left a warm
 * serverless instance with a stale connection string.
 */
export async function withPostgresAuthRecovery<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isPostgresAuthError(error)) {
      throw error;
    }
    console.error("[postgres] auth failure — resetting pool and retrying once");
    await resetSqlClient();
    return await fn();
  }
}
