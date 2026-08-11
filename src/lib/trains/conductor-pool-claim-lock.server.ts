import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";

import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";
import { throwPoolBusy } from "@/lib/trains/roll-errors.server";
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

/** Max time to wait for another spin's claim lock before failing closed. */
export const CONDUCTOR_POOL_CLAIM_LOCK_WAIT_MS = 8_000;
const LOCK_POLL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
 *
 * Waits up to {@link CONDUCTOR_POOL_CLAIM_LOCK_WAIT_MS} via try-lock polls
 * instead of blocking `pg_advisory_lock`, so a hung/slow prior spin cannot
 * pin every follow-up request until the gateway 504s.
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
  let locked = false;
  try {
    const deadline = Date.now() + CONDUCTOR_POOL_CLAIM_LOCK_WAIT_MS;
    while (true) {
      const rows = await sql<{ got: boolean }[]>`
        SELECT pg_try_advisory_lock(${k1}, ${k2}) AS got
      `;
      if (rows[0]?.got) {
        locked = true;
        break;
      }
      if (Date.now() >= deadline) {
        throwPoolBusy(key.poolType);
      }
      await sleep(LOCK_POLL_MS);
    }
    return await run();
  } finally {
    if (locked) {
      try {
        await sql`SELECT pg_advisory_unlock(${k1}, ${k2})`;
      } catch {
        // Connection drop unlocks advisory locks.
      }
    }
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // Best-effort shutdown — do not mask the caller's result.
    }
  }
}
