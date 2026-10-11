import "server-only";

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";
import { inheritHqMemberLinkToDiscordIfLinked } from "@/lib/member-link/inherit-hq-to-discord.server";
import { hasConflictingHqGameUidClaim } from "@/lib/member-link/link-claim-guards.shared";
import { isMemberLinkGameUidUniqueViolation } from "@/lib/member-link/member-link-game-uid-unique.shared";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { openMemberAllianceTenure } from "@/lib/members/member-tenure.server";
import {
  mergedCommanderFields,
  moveCommanderKeyedHistory,
} from "@/lib/members/merge-duplicate-commander.server";
import type {
  CommanderTransferErrorCode,
  CommanderTransferSummary,
} from "@/lib/admin/commander-transfer.shared";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export type CommanderTransferResult =
  | { ok: true; summary: CommanderTransferSummary }
  | { ok: false; code: CommanderTransferErrorCode };

export type CommanderTransferInput = {
  hqUserId: string;
  commanderId: string;
  destinationAllianceId: string;
  destinationAshedMemberId: string;
};

type RunInput = CommanderTransferInput & {
  destinationServer: number;
  actorHqUserId: string | null;
  sessionId: string | null;
};

type RunOutcome =
  | { ok: false; code: CommanderTransferErrorCode }
  | {
      ok: true;
      summary: CommanderTransferSummary;
      gameUid: string;
      memberName: string;
    };

class DryRunRollback extends Error {
  constructor(readonly outcome: RunOutcome) {
    super("commander transfer preview rollback");
  }
}

async function destinationOccupiedByOther(
  tx: Tx,
  input: RunInput,
  duplicateCommanderId: string | null,
): Promise<boolean> {
  const [hqLink] = await tx
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.destinationAllianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.destinationAshedMemberId),
        ne(schema.hqMemberLinks.hqUserId, input.hqUserId),
      ),
    )
    .limit(1);
  if (hqLink) return true;

  const discordLinks = await tx
    .select({ discordUserId: schema.discordMemberLinks.discordUserId })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, input.destinationAllianceId),
        eq(schema.discordMemberLinks.ashedMemberId, input.destinationAshedMemberId),
      ),
    );
  if (discordLinks.length > 0) {
    const owners = await tx
      .select({
        discordUserId: schema.discordHqLinks.discordUserId,
        hqUserId: schema.discordHqLinks.hqUserId,
      })
      .from(schema.discordHqLinks)
      .where(
        inArray(
          schema.discordHqLinks.discordUserId,
          discordLinks.map((row) => row.discordUserId),
        ),
      );
    const ownerByDiscord = new Map(owners.map((row) => [row.discordUserId, row.hqUserId]));
    if (
      discordLinks.some(
        (row) => ownerByDiscord.get(row.discordUserId) !== input.hqUserId,
      )
    ) {
      return true;
    }
  }

  if (duplicateCommanderId) {
    const [owner] = await tx
      .select({ id: schema.hqUserCommanders.id })
      .from(schema.hqUserCommanders)
      .where(
        and(
          eq(schema.hqUserCommanders.commanderId, duplicateCommanderId),
          ne(schema.hqUserCommanders.hqUserId, input.hqUserId),
        ),
      )
      .limit(1);
    if (owner) return true;
  }
  return false;
}

async function runTransfer(tx: Tx, input: RunInput): Promise<RunOutcome> {
  const [ownership] = await tx
    .select({ id: schema.hqUserCommanders.id })
    .from(schema.hqUserCommanders)
    .where(
      and(
        eq(schema.hqUserCommanders.hqUserId, input.hqUserId),
        eq(schema.hqUserCommanders.commanderId, input.commanderId),
      ),
    )
    .limit(1);
  if (!ownership) return { ok: false, code: "commander_not_linked" };

  const [kept] = await tx
    .select()
    .from(schema.commanders)
    .where(eq(schema.commanders.id, input.commanderId))
    .limit(1)
    .for("update");
  if (!kept) return { ok: false, code: "commander_not_linked" };
  if (!kept.gameUid) return { ok: false, code: "commander_missing_uid" };
  const gameUid = kept.gameUid;

  const [alliance] = await tx
    .select({ name: schema.alliances.name })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.destinationAllianceId))
    .limit(1);
  if (!alliance) return { ok: false, code: "destination_server_unknown" };

  const [roster] = await tx
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.destinationAllianceId),
        eq(schema.allianceMembers.ashedMemberId, input.destinationAshedMemberId),
      ),
    )
    .limit(1)
    .for("update");
  if (!roster || roster.status === "former") {
    return { ok: false, code: "destination_member_not_found" };
  }
  if (roster.gameUid && roster.gameUid !== gameUid) {
    return { ok: false, code: "destination_commander_has_uid" };
  }

  const [membership] = await tx
    .select({
      id: schema.commanderAllianceMemberships.id,
      commanderId: schema.commanderAllianceMemberships.commanderId,
    })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.destinationAllianceId),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          input.destinationAshedMemberId,
        ),
      ),
    )
    .limit(1);

  const duplicate =
    membership && membership.commanderId !== kept.id
      ? ((
          await tx
            .select()
            .from(schema.commanders)
            .where(eq(schema.commanders.id, membership.commanderId))
            .limit(1)
            .for("update")
        )[0] ?? null)
      : null;
  if (duplicate?.gameUid && duplicate.gameUid !== gameUid) {
    return { ok: false, code: "destination_commander_has_uid" };
  }

  if (await destinationOccupiedByOther(tx, input, duplicate?.id ?? null)) {
    return { ok: false, code: "destination_member_claimed" };
  }

  const [otherUserLink] = await tx
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.destinationAllianceId),
        eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
        ne(schema.hqMemberLinks.ashedMemberId, input.destinationAshedMemberId),
      ),
    )
    .limit(1);
  const [otherKeptMembership] = await tx
    .select({ id: schema.commanderAllianceMemberships.id })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.destinationAllianceId),
        eq(schema.commanderAllianceMemberships.commanderId, kept.id),
        eq(schema.commanderAllianceMemberships.status, "active"),
        ne(
          schema.commanderAllianceMemberships.ashedMemberId,
          input.destinationAshedMemberId,
        ),
      ),
    )
    .limit(1);
  if (otherUserLink || otherKeptMembership) {
    return { ok: false, code: "user_already_linked" };
  }

  const [hqUidClaims, discordUidClaims] = await Promise.all([
    tx
      .select({
        hqUserId: schema.hqMemberLinks.hqUserId,
        ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      })
      .from(schema.hqMemberLinks)
      .where(
        and(
          eq(schema.hqMemberLinks.allianceId, input.destinationAllianceId),
          eq(schema.hqMemberLinks.gameUid, gameUid),
        ),
      ),
    tx
      .select({
        discordUserId: schema.discordMemberLinks.discordUserId,
        ashedMemberId: schema.discordMemberLinks.ashedMemberId,
        hqUserId: schema.discordHqLinks.hqUserId,
      })
      .from(schema.discordMemberLinks)
      .leftJoin(
        schema.discordHqLinks,
        eq(schema.discordHqLinks.discordUserId, schema.discordMemberLinks.discordUserId),
      )
      .where(
        and(
          eq(schema.discordMemberLinks.allianceId, input.destinationAllianceId),
          eq(schema.discordMemberLinks.gameUid, gameUid),
        ),
      ),
  ]);
  if (
    hasConflictingHqGameUidClaim({
      hqUserId: input.hqUserId,
      ashedMemberId: input.destinationAshedMemberId,
      hqClaims: hqUidClaims,
      discordClaims: discordUidClaims,
    })
  ) {
    return { ok: false, code: "destination_member_claimed" };
  }

  const now = new Date();
  let historyCount = 0;
  let mergedFields: Partial<typeof schema.commanders.$inferInsert> = {};

  if (duplicate) {
    // Free the duplicate's identity keys before the kept commander takes them.
    await tx
      .update(schema.commanders)
      .set({
        gameUid: null,
        primaryNameNormalized: null,
        lastrankPublicId: null,
        currentAllianceId: null,
        updatedAt: now,
      })
      .where(eq(schema.commanders.id, duplicate.id));
    historyCount = await moveCommanderKeyedHistory(tx, {
      allianceId: input.destinationAllianceId,
      keptCommanderId: kept.id,
      dupCommanderId: duplicate.id,
    });
    await tx
      .delete(schema.hqUserCommanders)
      .where(eq(schema.hqUserCommanders.commanderId, duplicate.id));
    mergedFields = mergedCommanderFields(kept, duplicate, roster.currentName);
  }

  await tx
    .update(schema.commanders)
    .set({
      ...mergedFields,
      gameServerNumber: input.destinationServer,
      currentAllianceId: input.destinationAllianceId,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, kept.id));

  if (membership && membership.commanderId !== kept.id) {
    await tx
      .update(schema.commanderAllianceMemberships)
      .set({ commanderId: kept.id, status: "active", leftAt: null, updatedAt: now })
      .where(eq(schema.commanderAllianceMemberships.id, membership.id));
  }

  const [existingUserLink] = await tx
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.destinationAllianceId),
        eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
      ),
    )
    .limit(1);
  if (existingUserLink) {
    await tx
      .update(schema.hqMemberLinks)
      .set({ memberDisplayName: roster.currentName, gameUid, updatedAt: now })
      .where(eq(schema.hqMemberLinks.id, existingUserLink.id));
  } else {
    await tx.insert(schema.hqMemberLinks).values({
      id: nanoid(),
      allianceId: input.destinationAllianceId,
      hqUserId: input.hqUserId,
      ashedMemberId: input.destinationAshedMemberId,
      memberDisplayName: roster.currentName,
      gameUid,
      linkedAt: now,
      updatedAt: now,
    });
  }
  await tx
    .update(schema.allianceMembers)
    .set({ gameUid, updatedAt: now })
    .where(eq(schema.allianceMembers.id, roster.id));

  await writeAuditLog(
    {
      sessionId: input.sessionId,
      allianceId: input.destinationAllianceId,
      hqUserId: input.actorHqUserId,
      action: "commander_server_transferred",
      resourceType: "commander",
      resourceName: roster.currentName,
      resourceId: kept.id,
      metadata: {
        targetHqUserId: input.hqUserId,
        fromServer: kept.gameServerNumber,
        toServer: input.destinationServer,
        destinationAshedMemberId: input.destinationAshedMemberId,
        duplicateCommanderId: duplicate?.id ?? null,
        historyCount,
      },
      severity: "override",
    },
    tx,
  );

  return {
    ok: true,
    gameUid,
    memberName: roster.currentName,
    summary: {
      fromServer: kept.gameServerNumber,
      toServer: input.destinationServer,
      allianceName: alliance.name,
      memberName: roster.currentName,
      historyCount,
    },
  };
}

async function prepare(
  input: CommanderTransferInput,
): Promise<{ ok: true; destinationServer: number } | { ok: false; code: CommanderTransferErrorCode }> {
  const destinationServer = await resolveAllianceGameServerNumber(
    input.destinationAllianceId,
  );
  if (destinationServer == null) {
    return { ok: false, code: "destination_server_unknown" };
  }
  return { ok: true, destinationServer };
}

/** Dry run: performs the transfer inside a transaction, then rolls it back. */
export async function previewCommanderTransfer(
  input: CommanderTransferInput,
): Promise<CommanderTransferResult> {
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  try {
    await getDb().transaction(async (tx) => {
      const outcome = await runTransfer(tx, {
        ...input,
        destinationServer: prepared.destinationServer,
        actorHqUserId: null,
        sessionId: null,
      });
      throw new DryRunRollback(outcome);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      const { outcome } = error;
      return outcome.ok ? { ok: true, summary: outcome.summary } : outcome;
    }
    throw error;
  }
  throw new Error("commander transfer preview did not roll back");
}

/**
 * Moves a UID-bound commander to a roster entry in another alliance: merges
 * the destination's duplicate commander into it, updates its home server,
 * and links the HQ account to that roster entry in the same transaction. The
 * source alliance is left untouched.
 */
export async function transferCommander(
  input: CommanderTransferInput & {
    actorHqUserId: string | null;
    sessionId: string | null;
  },
): Promise<CommanderTransferResult> {
  const prepared = await prepare(input);
  if (!prepared.ok) return prepared;
  let outcome: RunOutcome;
  try {
    outcome = await getDb().transaction((tx) =>
      runTransfer(tx, { ...input, destinationServer: prepared.destinationServer }),
    );
  } catch (error) {
    // A concurrent link can claim the roster entry or UID after our checks;
    // the hq_member_links unique indexes reject it and the whole transfer rolls back.
    if (isMemberLinkGameUidUniqueViolation(error)) {
      return { ok: false, code: "destination_member_claimed" };
    }
    throw error;
  }
  if (!outcome.ok) return outcome;

  // Derived state only; the transfer and HQ link are already committed.
  const linkFields = {
    allianceId: input.destinationAllianceId,
    ashedMemberId: input.destinationAshedMemberId,
    gameUid: outcome.gameUid,
  };
  try {
    await openMemberAllianceTenure(linkFields);
    await syncCommanderIdentityFromMemberLink({
      ...linkFields,
      memberDisplayName: outcome.memberName,
      hqUserId: input.hqUserId,
    });
    await inheritHqMemberLinkToDiscordIfLinked({
      ...linkFields,
      hqUserId: input.hqUserId,
      memberDisplayName: outcome.memberName,
    });
  } catch (error) {
    console.error("[commander-transfer] post-link sync failed", {
      allianceId: input.destinationAllianceId,
      ashedMemberId: input.destinationAshedMemberId,
      hqUserId: input.hqUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: true, summary: outcome.summary };
}

/** Active roster entries in an alliance that no HQ account has claimed. */
export async function listCommanderTransferCandidates(
  allianceId: string,
): Promise<Array<{ ashedMemberId: string; currentName: string }>> {
  return getDb()
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .leftJoin(
      schema.hqMemberLinks,
      and(
        eq(schema.hqMemberLinks.allianceId, schema.allianceMembers.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, schema.allianceMembers.ashedMemberId),
      ),
    )
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        ne(schema.allianceMembers.status, "former"),
        isNull(schema.hqMemberLinks.id),
      ),
    )
    .orderBy(asc(schema.allianceMembers.currentName));
}
