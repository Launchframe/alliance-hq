import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import { getDatabaseUrl } from "./url";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  const url = getDatabaseUrl();

  if (!db) {
    client = postgres(url, { prepare: false, max: 10 });
    db = drizzle(client, { schema });
  }

  return db;
}

export { schema };
