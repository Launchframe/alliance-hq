import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";

import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";

function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("ashed-score-replace:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export type ScoreReplaceLockKey = {
  allianceId: string;
  scoreTarget: string;
  recordedDate: string;
};

/**
 * Serialize delete-by-date + bulk insert for one alliance/target/date.
 *
 * Uses a dedicated postgres connection so session advisory locks are not
 * shared across the pooled client (unlock must hit the same session).
 */
export async function withAshedScoreReplaceLock<T>(
  key: ScoreReplaceLockKey,
  run: () => Promise<T>,
): Promise<T> {
  const material = `${key.allianceId}\0${key.scoreTarget}\0${key.recordedDate}`;
  const [k1, k2] = advisoryLockPair(material);
  const sql = postgres(getDatabaseUrl(), {
    ...postgresClientOptions(),
    max: 1,
    idle_timeout: 5,
    max_lifetime: 60,
  });
  try {
    await sql`SELECT pg_advisory_lock(${k1}, ${k2})`;
    return await run();
  } finally {
    try {
      await sql`SELECT pg_advisory_unlock(${k1}, ${k2})`;
    } catch {
      // Connection drop unlocks advisory locks.
    }
    await sql.end({ timeout: 5 });
  }
}