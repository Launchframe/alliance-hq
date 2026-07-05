import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import { isPostgresAuthError } from "./error-message";
import {
  getSqlClient,
  resetSqlClient,
} from "./postgres-client";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let dbClient: ReturnType<typeof getSqlClient> | null = null;

function invalidateDrizzleClient(): void {
  db = null;
  dbClient = null;
}

export async function resetDbPool(): Promise<void> {
  await resetSqlClient();
  invalidateDrizzleClient();
}

export function getDb() {
  const client = getSqlClient();
  if (!db || dbClient !== client) {
    dbClient = client;
    db = drizzle(client, { schema });
  }

  return db;
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
    await resetDbPool();
    return await fn();
  }
}

export {
  getSqlClient,
  isServerlessPostgresRuntime,
  postgresClientOptions,
  resetSqlClient,
} from "./postgres-client";
export {
  isPostgresAuthError,
  postgresErrorCode,
} from "./error-message";
export { schema };
