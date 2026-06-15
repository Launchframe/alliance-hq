import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import { getSqlClient } from "./postgres-client";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!db) {
    db = drizzle(getSqlClient(), { schema });
  }

  return db;
}

export { getSqlClient, isServerlessPostgresRuntime, postgresClientOptions } from "./postgres-client";
export { schema };
