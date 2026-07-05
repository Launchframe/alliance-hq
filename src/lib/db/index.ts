import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
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

export {
  getSqlClient,
  isServerlessPostgresRuntime,
  postgresClientOptions,
  resetSqlClient,
  withPostgresAuthRecovery,
} from "./postgres-client";
export {
  isPostgresAuthError,
  postgresErrorCode,
} from "./error-message";
export { schema };
