import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";

import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";

function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("roster-ashed-sync:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Serialize a full Ashed → HQ roster sync for one alliance.
 *
 * Sync fetches Ashed over HTTP, upserts rows, then marks confirmed absences
 * former. Without a lock, a stale sync can fetch a list omitting M, a newer
 * sync can re-activate M, and the stale absence pass then marks M former.
 *
 * Dedicated connection + idle_timeout 0 so the session advisory lock spans the
 * Ashed HTTP gap (same pattern as scoreboard member-create / bank-deposit).
 */
export function rosterAshedSyncLockClientOptions(): NonNullable<
  Parameters<typeof postgres>[1]
> {
  return {
    ...postgresClientOptions(),
    max: 1,
    idle_timeout: 0,
    max_lifetime: 60 * 10,
  };
}

export async function withAllianceRosterAshedSyncLock<T>(
  allianceId: string,
  run: () => Promise<T>,
): Promise<T> {
  const [k1, k2] = advisoryLockPair(allianceId);
  const sql = postgres(getDatabaseUrl(), rosterAshedSyncLockClientOptions());
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
