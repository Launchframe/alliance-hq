import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";

import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";

function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("scoreboard-member-create:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export type ScoreboardMemberCreateLockKey = {
  allianceId: string;
  /** Normalized OCR/display name key (already lowercased / whitespace-collapsed). */
  normalizedName: string;
};

/**
 * Serialize scoreboard "create member from OCR name" for one alliance+name.
 *
 * Create calls Ashed HTTP between the existence check and the HQ insert. A
 * session advisory lock on the shared drizzle pool is unsafe: unlock may hit a
 * different pooled connection (max>1), and on serverless (max=1) idle_timeout
 * can drop the locking session mid-Ashed call — releasing the lock so a second
 * request inserts a duplicate roster row for the same name.
 *
 * Dedicated connection + idle_timeout 0 mirrors bank-deposit / Ashed
 * score-replace locks so the lock spans the HTTP gap.
 */
export function scoreboardMemberCreateLockClientOptions(): NonNullable<
  Parameters<typeof postgres>[1]
> {
  return {
    ...postgresClientOptions(),
    max: 1,
    idle_timeout: 0,
    max_lifetime: 60 * 10,
  };
}

export async function withScoreboardMemberCreateLock<T>(
  key: ScoreboardMemberCreateLockKey,
  run: () => Promise<T>,
): Promise<T> {
  const material = `${key.allianceId}\0${key.normalizedName}`;
  const [k1, k2] = advisoryLockPair(material);
  const sql = postgres(getDatabaseUrl(), scoreboardMemberCreateLockClientOptions());
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
