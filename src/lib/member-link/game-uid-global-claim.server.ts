import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  hasConflictingGlobalGameUidPrincipal,
  type GlobalGameUidDiscordClaim,
} from "@/lib/member-link/game-uid-global-claim.shared";

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
