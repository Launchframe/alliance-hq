import "server-only";

import { createHash } from "node:crypto";
import postgres from "postgres";

import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";

function advisoryLockPair(material: string): [number, number] {
  const digest = createHash("sha256")
    .update("bank-deposit-commit:")
    .update(material)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export type BankDepositCommitLockKey = {
  allianceId: string;
  bankId: string;
};

/**
 * Serialize deposit-slip history load + match + create/update for one bank.
 *
 * Video submit claims are per jobId only; without this lock two jobs (or a
 * stale-submit recovery overlapping an in-flight commit) can both snapshot an
 * empty/stale history and insert duplicate locked slips. Manual POST uses the
 * same key so officer creates serialize with OCR commits.
 *
 * Uses a dedicated postgres connection so session advisory locks are not
 * shared across the pooled client (unlock must hit the same session).
 */
export async function withBankDepositCommitLock<T>(
  key: BankDepositCommitLockKey,
  run: () => Promise<T>,
): Promise<T> {
  const material = `${key.allianceId}\0${key.bankId}`;
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
