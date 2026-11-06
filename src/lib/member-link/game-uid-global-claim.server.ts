import "server-only";

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getDb, schema } from "@/lib/db";
import { postgresClientOptions } from "@/lib/db/postgres-client";
import { getDatabaseUrl } from "@/lib/db/url";
import {
  hasConflictingGlobalGameUidPrincipal,
  type GlobalGameUidDiscordClaim,
} from "@/lib/member-link/game-uid-global-claim.shared";

function gameUidClaimLockPair(gameUid: string): [number, number] {
  const digest = createHash("sha256")
    .update("game-uid-claim:")
    .update(gameUid.trim())
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Serialize ownership recheck + claim writes for one Last War UID across HQ and
 * Discord link paths. Two principals can otherwise both pass a non-locking
 * read and persist conflicting claims. Dedicated connection (max 1) matches
 * other cross-request claim locks so unlock cannot hit a different pool slot.
 */
export async function withGameUidClaimLock<T>(
  gameUid: string,
  run: () => Promise<T>,
): Promise<T> {
  const trimmed = gameUid.trim();
  if (!trimmed) return run();

  const [k1, k2] = gameUidClaimLockPair(trimmed);
  const sql = postgres(getDatabaseUrl(), {
    ...postgresClientOptions(),
    max: 1,
    idle_timeout: 0,
    max_lifetime: 60 * 10,
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

/**
 * True when this Last War UID is already claimed by a different HQ or Discord
 * principal in any alliance (or via hq_user_commanders). Used to keep
 * server-transfer confirmation and member-link from rewriting another
 * account's commander home / co-owning their history.
 */
export async function isGameUidClaimedByOtherPrincipal(input: {
  gameUid: string;
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<boolean> {
  const trimmedUid = input.gameUid.trim();
  if (!trimmedUid) return false;

  const db = getDb();
  const discordUserId = input.discordUserId?.trim() || null;
  let hqUserId = input.hqUserId?.trim() || null;
  let callerDiscordHqUserId: string | null = null;

  if (discordUserId) {
    // Query discord_hq_links directly — do not import vr/repository (cycle).
    const [bridge] = await db
      .select({ hqUserId: schema.discordHqLinks.hqUserId })
      .from(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.discordUserId, discordUserId))
      .limit(1);
    callerDiscordHqUserId = bridge?.hqUserId ?? null;
    if (!hqUserId) {
      hqUserId = callerDiscordHqUserId;
    }
  }

  const [hqRows, discordRows, commanderRow] = await Promise.all([
    db
      .select({ hqUserId: schema.hqMemberLinks.hqUserId })
      .from(schema.hqMemberLinks)
      .where(eq(schema.hqMemberLinks.gameUid, trimmedUid)),
    db
      .select({
        discordUserId: schema.discordMemberLinks.discordUserId,
        hqUserId: schema.discordHqLinks.hqUserId,
      })
      .from(schema.discordMemberLinks)
      .leftJoin(
        schema.discordHqLinks,
        eq(
          schema.discordHqLinks.discordUserId,
          schema.discordMemberLinks.discordUserId,
        ),
      )
      .where(eq(schema.discordMemberLinks.gameUid, trimmedUid)),
    db
      .select({ id: schema.commanders.id })
      .from(schema.commanders)
      .where(eq(schema.commanders.gameUid, trimmedUid))
      .limit(1),
  ]);

  let commanderOwnerHqUserIds: string[] = [];
  if (commanderRow[0]) {
    const owners = await db
      .select({ hqUserId: schema.hqUserCommanders.hqUserId })
      .from(schema.hqUserCommanders)
      .where(eq(schema.hqUserCommanders.commanderId, commanderRow[0].id));
    commanderOwnerHqUserIds = owners.map((row) => row.hqUserId);
  }

  const discordClaims: GlobalGameUidDiscordClaim[] = discordRows.map((row) => ({
    discordUserId: row.discordUserId,
    hqUserId: row.hqUserId ?? null,
  }));
  const hqClaimHqUserIds = hqRows.map((row) => row.hqUserId);

  // Prefer HQ principal when known so same-person Discord+HQ links evaluate
  // against HQ ownership (multi-alliance transfers by the owner).
  if (hqUserId) {
    return hasConflictingGlobalGameUidPrincipal({
      hqUserId,
      hqClaimHqUserIds,
      discordClaims,
      commanderOwnerHqUserIds,
    });
  }

  return hasConflictingGlobalGameUidPrincipal({
    discordUserId,
    callerDiscordHqUserId,
    hqClaimHqUserIds,
    discordClaims,
    commanderOwnerHqUserIds,
  });
}
