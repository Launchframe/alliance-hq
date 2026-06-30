import "server-only";

import { and, eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";

export type UnlinkCommanderTarget = "hq" | "discord";

export type UnlinkCommanderResult =
  | { ok: true; target: UnlinkCommanderTarget; removed: number }
  | { ok: false; reason: "not_linked" };

/**
 * Resolve the Commander identity row id for a roster member, used to unwind the
 * `hq_user_commanders` ownership binding on a break-glass HQ unlink.
 */
async function resolveCommanderId(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ commanderId: schema.commanderAllianceMemberships.commanderId })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row?.commanderId ?? null;
}

/**
 * Break-glass: remove the HQ account binding for a roster commander so the
 * commander can be claimed again. Caller authorization (alliance owner or
 * platform maintainer) is enforced at the API boundary — this module assumes
 * the action is already authorized and records the audit trail.
 *
 * Also unwinds the `hq_user_commanders` ownership binding, clears a dangling
 * `ownerMemberExternalId` (so a re-claimer cannot inherit Discord owner proof),
 * and clears the previous owner's `primaryGameUid` when it matched this link.
 */
export async function unlinkCommanderHqAccount(input: {
  sessionId: string;
  actorHqUserId: string;
  allianceId: string;
  ashedMemberId: string;
}): Promise<UnlinkCommanderResult> {
  const db = getDb();

  const [link] = await db
    .select({
      id: schema.hqMemberLinks.id,
      hqUserId: schema.hqMemberLinks.hqUserId,
      gameUid: schema.hqMemberLinks.gameUid,
    })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!link) {
    return { ok: false, reason: "not_linked" };
  }

  await db
    .delete(schema.hqMemberLinks)
    .where(eq(schema.hqMemberLinks.id, link.id));

  const commanderId = await resolveCommanderId(
    input.allianceId,
    input.ashedMemberId,
  );
  if (commanderId) {
    await db
      .delete(schema.hqUserCommanders)
      .where(
        and(
          eq(schema.hqUserCommanders.commanderId, commanderId),
          eq(schema.hqUserCommanders.hqUserId, link.hqUserId),
        ),
      );
  }

  // Clear a dangling owner-proof pointer so a future claimer of this commander
  // does not silently inherit Discord owner authority.
  await db
    .update(schema.alliances)
    .set({ ownerMemberExternalId: null })
    .where(
      and(
        eq(schema.alliances.id, input.allianceId),
        eq(schema.alliances.ownerMemberExternalId, input.ashedMemberId),
      ),
    );

  if (link.gameUid) {
    await db
      .update(schema.hqUsers)
      .set({ primaryGameUid: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.hqUsers.id, link.hqUserId),
          eq(schema.hqUsers.primaryGameUid, link.gameUid),
        ),
      );
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    hqUserId: input.actorHqUserId,
    allianceId: input.allianceId,
    action: "member_link.hq_unlinked",
    metadata: {
      ashedMemberId: input.ashedMemberId,
      previousHqUserId: link.hqUserId,
    },
  });

  return { ok: true, target: "hq", removed: 1 };
}

/**
 * Break-glass: remove all Discord member links bound to a roster commander in
 * this alliance. Authorization is enforced at the API boundary.
 */
export async function unlinkCommanderDiscordLinks(input: {
  sessionId: string;
  actorHqUserId: string;
  allianceId: string;
  ashedMemberId: string;
}): Promise<UnlinkCommanderResult> {
  const db = getDb();

  const removed = await db
    .delete(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, input.allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .returning({ id: schema.discordMemberLinks.id });

  if (removed.length === 0) {
    return { ok: false, reason: "not_linked" };
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    hqUserId: input.actorHqUserId,
    allianceId: input.allianceId,
    action: "member_link.discord_unlinked",
    metadata: {
      ashedMemberId: input.ashedMemberId,
      removed: removed.length,
    },
  });

  return { ok: true, target: "discord", removed: removed.length };
}
