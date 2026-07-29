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
 *
 * Connection timeouts must not outlive `run()`: Ashed HTTP is idle from
 * postgres.js's perspective, so a short idle_timeout / max_lifetime would
 * close the session, drop the advisory lock, and allow interleaved deletes.
 */
export function ashedScoreReplaceLockClientOptions(): NonNullable<
  Parameters<typeof postgres>[1]
> {
  return {
    ...postgresClientOptions(),
    max: 1,
    idle_timeout: 0,
    max_lifetime: 60 * 10,
  };
}

export async function withAshedScoreReplaceLock<T>(
  key: ScoreReplaceLockKey,
  run: () => Promise<T>,
): Promise<T> {
  const material = `${key.allianceId}\0${key.scoreTarget}\0${key.recordedDate}`;
  const [k1, k2] = advisoryLockPair(material);
  const sql = postgres(getDatabaseUrl(), ashedScoreReplaceLockClientOptions());
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
