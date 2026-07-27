import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";

import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";
import type { PoolType } from "@/lib/trains/types";

function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("conductor-pool-claim:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export type ConductorPoolClaimLockKey = {
  allianceId: string;
  poolType: PoolType;
};

/**
 * Serialize depleting-pool list → pick → claim for one alliance pool.
 *
 * `rollFromPool` previously listed `selected_at IS NULL` rows then updated by
 * id with no conditional claim. Parallel officer spins for different dates
 * could both mark the same `conductor_pool_entries` row (last `selectedForDate`
 * wins) while two day records claimed the member.
 *
 * Uses a dedicated postgres connection so session advisory locks are not
 * shared across the pooled client (unlock must hit the same session).
 */
export async function withConductorPoolClaimLock<T>(
  key: ConductorPoolClaimLockKey,
  run: () => Promise<T>,
): Promise<T> {
  const material = `${key.allianceId}\0${key.poolType}`;
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
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // Best-effort shutdown — do not mask the caller's result.
    }
  }
}
