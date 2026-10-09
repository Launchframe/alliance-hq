import "server-only";

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { isSyntheticNativeAshedAllianceId } from "@/lib/lastrank/ashed-credential.server";
import { markAshedMemberFormer } from "@/lib/members/ashed-member-write.server";
import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";
import {
  duplicateValueIsNewer,
  evaluateMergeEligibility,
  mergedPreviousNames,
  type MergeDuplicateErrorCode,
  type MergeSide,
} from "@/lib/members/merge-duplicate-commander.shared";
import { syncMemberNameToAshed } from "@/lib/members/member-name-sync.server";
import { resolveAllianceAshedBotConnection } from "@/lib/vr/member-roster";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export type MergeDuplicateSummary = {
  keptName: string;
  duplicateName: string;
  newName: string;
  oldName: string;
  historyCount: number;
};

export type MergeDuplicateResult =
  | { ok: true; summary: MergeDuplicateSummary }
  | { ok: false; code: MergeDuplicateErrorCode };

type MergeInput = {
  allianceId: string;
  keptAshedMemberId: string;
  duplicateAshedMemberId: string;
};

type LoadedSide = MergeSide & {
  rosterRowId: string;
  ashedAllianceId: string;
  currentName: string;
  previousNames: string[];
  commander: typeof schema.commanders.$inferSelect | null;
};

class DryRunRollback extends Error {
  constructor(readonly result: MergeDuplicateResult) {
    super("merge preview rollback");
  }
}

async function loadSide(
  tx: Tx,
  allianceId: string,
  ashedMemberId: string,
): Promise<LoadedSide | null> {
  const [roster] = await tx
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1)
    .for("update");
  if (!roster) return null;

  const [membership] = await tx
    .select({ commanderId: schema.commanderAllianceMemberships.commanderId })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  const commander = membership
    ? ((
        await tx
          .select()
          .from(schema.commanders)
          .where(eq(schema.commanders.id, membership.commanderId))
          .limit(1)
          .for("update")
      )[0] ?? null)
    : null;

  const [hqLinks, ownerRows, discordLinks] = await Promise.all([
    tx
      .select({ hqUserId: schema.hqMemberLinks.hqUserId })
      .from(schema.hqMemberLinks)
      .where(
        and(
          eq(schema.hqMemberLinks.allianceId, allianceId),
          eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
        ),
      ),
    commander
      ? tx
          .select({ hqUserId: schema.hqUserCommanders.hqUserId })
          .from(schema.hqUserCommanders)
          .where(eq(schema.hqUserCommanders.commanderId, commander.id))
      : Promise.resolve([] as Array<{ hqUserId: string }>),
    tx
      .select({ discordUserId: schema.discordMemberLinks.discordUserId })
      .from(schema.discordMemberLinks)
      .where(
        and(
          eq(schema.discordMemberLinks.allianceId, allianceId),
          eq(schema.discordMemberLinks.ashedMemberId, ashedMemberId),
        ),
      )
      .limit(1),
  ]);

  return {
    ashedMemberId,
    rosterRowId: roster.id,
    rosterStatus: roster.status,
    ashedAllianceId: roster.ashedAllianceId,
    currentName: roster.currentName,
    previousNames: roster.previousNamesJson ?? [],
    commanderId: commander?.id ?? null,
    commander,
    gameServerNumber: commander?.gameServerNumber ?? null,
    gameUid: commander?.gameUid ?? roster.gameUid ?? null,
    lastrankPublicId: commander?.lastrankPublicId ?? null,
    hqUserIds: [
      ...new Set([...hqLinks, ...ownerRows].map((row) => row.hqUserId)),
    ],
    discordUserId: discordLinks[0]?.discordUserId ?? null,
  };
}

function mergedCommanderFields(
  kept: typeof schema.commanders.$inferSelect,
  dup: typeof schema.commanders.$inferSelect,
  newName: string,
): Partial<typeof schema.commanders.$inferInsert> {
  const next: Partial<typeof schema.commanders.$inferInsert> = {
    primaryName: newName,
    primaryNameNormalized: normalizeCommanderName(newName),
    canonicalName: dup.canonicalName ?? kept.canonicalName,
  };

  if (kept.gameUid == null && dup.gameUid != null) next.gameUid = dup.gameUid;
  if (kept.gameServerNumber == null && dup.gameServerNumber != null) {
    next.gameServerNumber = dup.gameServerNumber;
  }

  if (dup.lastrankPublicId != null) {
    next.lastrankPublicId = dup.lastrankPublicId;
    next.lastrankCountry = dup.lastrankCountry ?? kept.lastrankCountry;
    next.lastrankProfileUrl = dup.lastrankProfileUrl ?? kept.lastrankProfileUrl;
    next.lastrankProfileImageUrl =
      dup.lastrankProfileImageUrl ?? kept.lastrankProfileImageUrl;
  }

  if (dup.profession != null) {
    next.profession = dup.profession;
    next.professionalLevel = dup.professionalLevel;
  }

  if (
    duplicateValueIsNewer({
      keptValuePresent: kept.memberLevel != null,
      duplicateValuePresent: dup.memberLevel != null,
      keptUpdatedAt: kept.levelUpdatedAt,
      duplicateUpdatedAt: dup.levelUpdatedAt,
    })
  ) {
    next.memberLevel = dup.memberLevel;
    next.levelUpdatedAt = dup.levelUpdatedAt;
  }
  if (
    duplicateValueIsNewer({
      keptValuePresent: kept.currentTotalHeroPower != null,
      duplicateValuePresent: dup.currentTotalHeroPower != null,
      keptUpdatedAt: kept.thpUpdatedAt,
      duplicateUpdatedAt: dup.thpUpdatedAt,
    })
  ) {
    next.currentTotalHeroPower = dup.currentTotalHeroPower;
    next.currentThpBreakdown = dup.currentThpBreakdown;
    next.thpUpdatedAt = dup.thpUpdatedAt;
  }
  if (
    duplicateValueIsNewer({
      keptValuePresent: kept.currentKills != null,
      duplicateValuePresent: dup.currentKills != null,
      keptUpdatedAt: kept.killsUpdatedAt,
      duplicateUpdatedAt: dup.killsUpdatedAt,
    })
  ) {
    next.currentKills = dup.currentKills;
    next.killsUpdatedAt = dup.killsUpdatedAt;
  }
  if (
    duplicateValueIsNewer({
      keptValuePresent: kept.powerLevel != null,
      duplicateValuePresent: dup.powerLevel != null,
      keptUpdatedAt: kept.updatedAt,
      duplicateUpdatedAt: dup.updatedAt,
    })
  ) {
    next.powerLevel = dup.powerLevel;
  }

  if (kept.mainSquad == null && dup.mainSquad != null) {
    next.mainSquad = dup.mainSquad;
    next.mainSquadSource = dup.mainSquadSource;
    next.mainSquadUpdatedAt = dup.mainSquadUpdatedAt;
  }
  if (kept.currentSquadPowerJson == null && dup.currentSquadPowerJson != null) {
    next.currentSquadPowerJson = dup.currentSquadPowerJson;
  }

  return next;
}

/** Moves history from the duplicate onto the kept member; the kept side wins clashes. */
async function moveHistory(
  tx: Tx,
  input: {
    allianceId: string;
    kept: LoadedSide & { commanderId: string };
    dup: LoadedSide & { commanderId: string };
  },
): Promise<number> {
  const { allianceId, kept, dup } = input;
  const K = kept.commanderId;
  const D = dup.commanderId;
  let moved = 0;
  const count = (rows: unknown[]) => {
    moved += rows.length;
  };

  // Commander-keyed append-only timelines.
  count(
    await tx
      .update(schema.commanderThpEvents)
      .set({ commanderId: K })
      .where(eq(schema.commanderThpEvents.commanderId, D))
      .returning({ id: schema.commanderThpEvents.id }),
  );
  count(
    await tx
      .update(schema.commanderKillsEvents)
      .set({ commanderId: K })
      .where(eq(schema.commanderKillsEvents.commanderId, D))
      .returning({ id: schema.commanderKillsEvents.id }),
  );
  count(
    await tx
      .update(schema.commanderLevelEvents)
      .set({ commanderId: K })
      .where(eq(schema.commanderLevelEvents.commanderId, D))
      .returning({ id: schema.commanderLevelEvents.id }),
  );
  count(
    await tx
      .update(schema.commanderSeasonVrEvents)
      .set({ commanderId: K })
      .where(eq(schema.commanderSeasonVrEvents.commanderId, D))
      .returning({ id: schema.commanderSeasonVrEvents.id }),
  );
  count(
    await tx
      .update(schema.commanderVsInventoryEvents)
      .set({ commanderId: K })
      .where(eq(schema.commanderVsInventoryEvents.commanderId, D))
      .returning({ id: schema.commanderVsInventoryEvents.id }),
  );

  // One power snapshot per day: the kept commander's day wins.
  await tx
    .delete(schema.commanderPowerLevelEvents)
    .where(
      and(
        eq(schema.commanderPowerLevelEvents.commanderId, D),
        inArray(
          schema.commanderPowerLevelEvents.recordedDate,
          tx
            .select({ d: schema.commanderPowerLevelEvents.recordedDate })
            .from(schema.commanderPowerLevelEvents)
            .where(eq(schema.commanderPowerLevelEvents.commanderId, K)),
        ),
      ),
    );
  count(
    await tx
      .update(schema.commanderPowerLevelEvents)
      .set({ commanderId: K })
      .where(eq(schema.commanderPowerLevelEvents.commanderId, D))
      .returning({ id: schema.commanderPowerLevelEvents.id }),
  );

  // One VR head per season.
  await tx
    .delete(schema.commanderSeasonVr)
    .where(
      and(
        eq(schema.commanderSeasonVr.commanderId, D),
        inArray(
          schema.commanderSeasonVr.seasonKey,
          tx
            .select({ k: schema.commanderSeasonVr.seasonKey })
            .from(schema.commanderSeasonVr)
            .where(eq(schema.commanderSeasonVr.commanderId, K)),
        ),
      ),
    );
  count(
    await tx
      .update(schema.commanderSeasonVr)
      .set({ commanderId: K })
      .where(eq(schema.commanderSeasonVr.commanderId, D))
      .returning({ id: schema.commanderSeasonVr.id }),
  );

  const [keptInventory] = await tx
    .select({ id: schema.commanderVsInventories.commanderId })
    .from(schema.commanderVsInventories)
    .where(eq(schema.commanderVsInventories.commanderId, K))
    .limit(1);
  if (keptInventory) {
    await tx
      .delete(schema.commanderVsInventories)
      .where(eq(schema.commanderVsInventories.commanderId, D));
  } else {
    count(
      await tx
        .update(schema.commanderVsInventories)
        .set({ commanderId: K })
        .where(eq(schema.commanderVsInventories.commanderId, D))
        .returning({ id: schema.commanderVsInventories.commanderId }),
    );
  }

  // Ashed stat conflicts describe the duplicate's (retired) Ashed row.
  await tx
    .delete(schema.hqAshedStatSyncConflicts)
    .where(eq(schema.hqAshedStatSyncConflicts.commanderId, D));

  await tx
    .update(schema.bankDepositSlips)
    .set({ commanderId: K })
    .where(eq(schema.bankDepositSlips.commanderId, D));
  await tx
    .update(schema.bankDepositSlips)
    .set({ allianceMemberId: kept.rosterRowId })
    .where(eq(schema.bankDepositSlips.allianceMemberId, dup.rosterRowId));

  // War Leader / Engineer pairing.
  const [keptTeam] = await tx
    .select({ id: schema.wlTeams.id })
    .from(schema.wlTeams)
    .where(
      and(eq(schema.wlTeams.allianceId, allianceId), eq(schema.wlTeams.wlCommanderId, K)),
    )
    .limit(1);
  const [dupTeam] = await tx
    .select({ id: schema.wlTeams.id })
    .from(schema.wlTeams)
    .where(
      and(eq(schema.wlTeams.allianceId, allianceId), eq(schema.wlTeams.wlCommanderId, D)),
    )
    .limit(1);
  if (dupTeam && keptTeam) {
    await tx
      .delete(schema.wlEngAssignments)
      .where(
        and(
          eq(schema.wlEngAssignments.wlTeamId, dupTeam.id),
          inArray(
            schema.wlEngAssignments.engCommanderId,
            tx
              .select({ e: schema.wlEngAssignments.engCommanderId })
              .from(schema.wlEngAssignments)
              .where(eq(schema.wlEngAssignments.wlTeamId, keptTeam.id)),
          ),
        ),
      );
    await tx
      .update(schema.wlEngAssignments)
      .set({ wlTeamId: keptTeam.id })
      .where(eq(schema.wlEngAssignments.wlTeamId, dupTeam.id));
    await tx
      .update(schema.wlTeamEvents)
      .set({ wlTeamId: keptTeam.id })
      .where(eq(schema.wlTeamEvents.wlTeamId, dupTeam.id));
    await tx.delete(schema.wlTeams).where(eq(schema.wlTeams.id, dupTeam.id));
  } else if (dupTeam) {
    await tx
      .update(schema.wlTeams)
      .set({ wlCommanderId: K, updatedAt: new Date() })
      .where(eq(schema.wlTeams.id, dupTeam.id));
  }
  await tx
    .delete(schema.wlEngAssignments)
    .where(
      and(
        eq(schema.wlEngAssignments.engCommanderId, D),
        inArray(
          schema.wlEngAssignments.wlTeamId,
          tx
            .select({ t: schema.wlEngAssignments.wlTeamId })
            .from(schema.wlEngAssignments)
            .where(eq(schema.wlEngAssignments.engCommanderId, K)),
        ),
      ),
    );
  await tx
    .update(schema.wlEngAssignments)
    .set({ engCommanderId: K })
    .where(eq(schema.wlEngAssignments.engCommanderId, D));
  await tx
    .update(schema.wlEngAssignments)
    .set({ dismissedByCommanderId: K })
    .where(eq(schema.wlEngAssignments.dismissedByCommanderId, D));
  await tx
    .update(schema.wlTeamEvents)
    .set({ actorCommanderId: K })
    .where(eq(schema.wlTeamEvents.actorCommanderId, D));
  await tx
    .update(schema.wlTeamEvents)
    .set({ subjectCommanderId: K })
    .where(eq(schema.wlTeamEvents.subjectCommanderId, D));

  // Roster-member-keyed history within this alliance.
  const dupMember = and(
    eq(schema.memberSeasonVr.allianceId, allianceId),
    eq(schema.memberSeasonVr.ashedMemberId, dup.ashedMemberId),
  );
  await tx
    .delete(schema.memberSeasonVr)
    .where(
      and(
        dupMember,
        inArray(
          schema.memberSeasonVr.seasonKey,
          tx
            .select({ k: schema.memberSeasonVr.seasonKey })
            .from(schema.memberSeasonVr)
            .where(
              and(
                eq(schema.memberSeasonVr.allianceId, allianceId),
                eq(schema.memberSeasonVr.ashedMemberId, kept.ashedMemberId),
              ),
            ),
        ),
      ),
    );
  count(
    await tx
      .update(schema.memberSeasonVr)
      .set({ ashedMemberId: kept.ashedMemberId })
      .where(dupMember)
      .returning({ id: schema.memberSeasonVr.id }),
  );
  count(
    await tx
      .update(schema.memberSeasonVrEvents)
      .set({ ashedMemberId: kept.ashedMemberId })
      .where(
        and(
          eq(schema.memberSeasonVrEvents.allianceId, allianceId),
          eq(schema.memberSeasonVrEvents.ashedMemberId, dup.ashedMemberId),
        ),
      )
      .returning({ id: schema.memberSeasonVrEvents.id }),
  );
  count(
    await tx
      .update(schema.memberAllianceRankEvents)
      .set({ ashedMemberId: kept.ashedMemberId })
      .where(
        and(
          eq(schema.memberAllianceRankEvents.allianceId, allianceId),
          eq(schema.memberAllianceRankEvents.ashedMemberId, dup.ashedMemberId),
        ),
      )
      .returning({ id: schema.memberAllianceRankEvents.id }),
  );
  count(
    await tx
      .update(schema.memberCommendations)
      .set({ ashedMemberId: kept.ashedMemberId })
      .where(
        and(
          eq(schema.memberCommendations.allianceId, allianceId),
          eq(schema.memberCommendations.ashedMemberId, dup.ashedMemberId),
        ),
      )
      .returning({ id: schema.memberCommendations.id }),
  );
  count(
    await tx
      .update(schema.memberViolations)
      .set({ ashedMemberId: kept.ashedMemberId })
      .where(
        and(
          eq(schema.memberViolations.allianceId, allianceId),
          eq(schema.memberViolations.ashedMemberId, dup.ashedMemberId),
        ),
      )
      .returning({ id: schema.memberViolations.id }),
  );
  count(
    await tx
      .update(schema.memberTimeOff)
      .set({ ashedMemberId: kept.ashedMemberId })
      .where(
        and(
          eq(schema.memberTimeOff.allianceId, allianceId),
          eq(schema.memberTimeOff.ashedMemberId, dup.ashedMemberId),
        ),
      )
      .returning({ id: schema.memberTimeOff.id }),
  );

  await tx
    .delete(schema.memberRoleNudges)
    .where(
      and(
        eq(schema.memberRoleNudges.allianceId, allianceId),
        eq(schema.memberRoleNudges.ashedMemberId, dup.ashedMemberId),
        eq(schema.memberRoleNudges.status, "open"),
        inArray(
          schema.memberRoleNudges.kind,
          tx
            .select({ k: schema.memberRoleNudges.kind })
            .from(schema.memberRoleNudges)
            .where(
              and(
                eq(schema.memberRoleNudges.allianceId, allianceId),
                eq(schema.memberRoleNudges.ashedMemberId, kept.ashedMemberId),
                eq(schema.memberRoleNudges.status, "open"),
              ),
            ),
        ),
      ),
    );
  await tx
    .update(schema.memberRoleNudges)
    .set({ ashedMemberId: kept.ashedMemberId })
    .where(
      and(
        eq(schema.memberRoleNudges.allianceId, allianceId),
        eq(schema.memberRoleNudges.ashedMemberId, dup.ashedMemberId),
      ),
    );

  await tx
    .delete(schema.performanceNoteMembers)
    .where(
      and(
        eq(schema.performanceNoteMembers.allianceId, allianceId),
        eq(schema.performanceNoteMembers.ashedMemberId, dup.ashedMemberId),
        inArray(
          schema.performanceNoteMembers.noteId,
          tx
            .select({ n: schema.performanceNoteMembers.noteId })
            .from(schema.performanceNoteMembers)
            .where(
              and(
                eq(schema.performanceNoteMembers.allianceId, allianceId),
                eq(schema.performanceNoteMembers.ashedMemberId, kept.ashedMemberId),
              ),
            ),
        ),
      ),
    );
  count(
    await tx
      .update(schema.performanceNoteMembers)
      .set({ ashedMemberId: kept.ashedMemberId, allianceMemberId: kept.rosterRowId })
      .where(
        and(
          eq(schema.performanceNoteMembers.allianceId, allianceId),
          eq(schema.performanceNoteMembers.ashedMemberId, dup.ashedMemberId),
        ),
      )
      .returning({ id: schema.performanceNoteMembers.id }),
  );

  await tx
    .update(schema.officerActionItems)
    .set({ assigneeAllianceMemberId: kept.rosterRowId })
    .where(
      and(
        eq(schema.officerActionItems.allianceId, allianceId),
        eq(schema.officerActionItems.assigneeAllianceMemberId, dup.rosterRowId),
      ),
    );

  // Public tip codes must not keep resolving against the retired slot.
  await tx
    .update(schema.commanderStoreTipLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.commanderStoreTipLinks.allianceId, allianceId),
        eq(schema.commanderStoreTipLinks.ashedMemberId, dup.ashedMemberId),
        isNull(schema.commanderStoreTipLinks.revokedAt),
      ),
    );

  return moved;
}

async function moveLinks(
  tx: Tx,
  input: {
    allianceId: string;
    kept: LoadedSide & { commanderId: string };
    dup: LoadedSide & { commanderId: string };
    now: Date;
  },
): Promise<void> {
  const { allianceId, kept, dup, now } = input;

  const dupHqLink = and(
    eq(schema.hqMemberLinks.allianceId, allianceId),
    eq(schema.hqMemberLinks.ashedMemberId, dup.ashedMemberId),
  );
  const [keptHqLink] = await tx
    .select({ id: schema.hqMemberLinks.id })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, kept.ashedMemberId),
      ),
    )
    .limit(1);
  if (keptHqLink) {
    await tx.delete(schema.hqMemberLinks).where(dupHqLink);
  } else {
    await tx
      .update(schema.hqMemberLinks)
      .set({ ashedMemberId: kept.ashedMemberId, updatedAt: now })
      .where(dupHqLink);
  }

  const dupDiscordLink = and(
    eq(schema.discordMemberLinks.allianceId, allianceId),
    eq(schema.discordMemberLinks.ashedMemberId, dup.ashedMemberId),
  );
  if (kept.discordUserId) {
    await tx.delete(schema.discordMemberLinks).where(dupDiscordLink);
  } else {
    await tx
      .update(schema.discordMemberLinks)
      .set({ ashedMemberId: kept.ashedMemberId, updatedAt: now })
      .where(dupDiscordLink);
  }

  await tx
    .delete(schema.hqUserCommanders)
    .where(
      and(
        eq(schema.hqUserCommanders.commanderId, dup.commanderId),
        inArray(
          schema.hqUserCommanders.hqUserId,
          tx
            .select({ u: schema.hqUserCommanders.hqUserId })
            .from(schema.hqUserCommanders)
            .where(eq(schema.hqUserCommanders.commanderId, kept.commanderId)),
        ),
      ),
    );
  await tx
    .update(schema.hqUserCommanders)
    .set({ commanderId: kept.commanderId, updatedAt: now })
    .where(eq(schema.hqUserCommanders.commanderId, dup.commanderId));
}

async function runMerge(
  tx: Tx,
  input: MergeInput & { actorHqUserId: string | null; sessionId: string | null },
): Promise<MergeDuplicateResult> {
  // Lock in a stable order so two concurrent merges of the same pair cannot deadlock.
  const ordered = [input.keptAshedMemberId, input.duplicateAshedMemberId].sort();
  const loaded = new Map<string, LoadedSide | null>();
  for (const id of ordered) {
    if (!loaded.has(id)) loaded.set(id, await loadSide(tx, input.allianceId, id));
  }
  const kept = loaded.get(input.keptAshedMemberId) ?? null;
  const dup = loaded.get(input.duplicateAshedMemberId) ?? null;
  if (input.keptAshedMemberId === input.duplicateAshedMemberId) {
    return { ok: false, code: "same_member" };
  }
  if (!kept || !dup) return { ok: false, code: "not_active" };

  const eligibility = evaluateMergeEligibility(kept, dup);
  if (!eligibility.ok) return eligibility;
  if (!kept.commander || !dup.commander || !kept.commanderId || !dup.commanderId) {
    return { ok: false, code: "not_active" };
  }
  const keptSide = { ...kept, commanderId: kept.commanderId };
  const dupSide = { ...dup, commanderId: dup.commanderId };

  const now = new Date();
  const newName = dup.currentName.trim() || kept.currentName;
  const previousNames = mergedPreviousNames({
    keptCurrentName: kept.currentName,
    keptPreviousNames: kept.previousNames,
    duplicatePreviousNames: dup.previousNames,
    newName,
  });

  // Free the duplicate's identity keys before the kept commander takes them
  // (partial unique indexes on UID and orphan name + server).
  await tx
    .update(schema.commanders)
    .set({
      gameUid: null,
      primaryNameNormalized: null,
      lastrankPublicId: null,
      currentAllianceId: null,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, dupSide.commanderId));

  await moveLinks(tx, {
    allianceId: input.allianceId,
    kept: keptSide,
    dup: dupSide,
    now,
  });
  const historyCount = await moveHistory(tx, {
    allianceId: input.allianceId,
    kept: keptSide,
    dup: dupSide,
  });

  await tx
    .update(schema.commanders)
    .set({
      ...mergedCommanderFields(kept.commander, dup.commander, newName),
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, keptSide.commanderId));

  await tx
    .update(schema.allianceMembers)
    .set({ status: "former", gameUid: null, updatedAt: now })
    .where(eq(schema.allianceMembers.id, dup.rosterRowId));
  await tx
    .update(schema.allianceMembers)
    .set({
      currentName: newName,
      previousNamesJson: previousNames,
      ...(kept.gameUid == null && dup.gameUid != null ? { gameUid: dup.gameUid } : {}),
      updatedAt: now,
    })
    .where(eq(schema.allianceMembers.id, kept.rosterRowId));
  await tx
    .update(schema.commanderAllianceMemberships)
    .set({ status: "former", leftAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, dup.ashedMemberId),
      ),
    );

  await writeAuditLog(
    {
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      hqUserId: input.actorHqUserId,
      action: "member_duplicate_merged",
      resourceType: "commander",
      resourceName: newName,
      resourceId: keptSide.commanderId,
      metadata: {
        keptAshedMemberId: kept.ashedMemberId,
        duplicateAshedMemberId: dup.ashedMemberId,
        duplicateCommanderId: dupSide.commanderId,
        previousName: kept.currentName,
        historyCount,
      },
      severity: "override",
    },
    tx,
  );

  return {
    ok: true,
    summary: {
      keptName: kept.currentName,
      duplicateName: dup.currentName,
      newName,
      oldName: kept.currentName,
      historyCount,
    },
  };
}

/** Dry run: performs the merge inside a transaction, then rolls it back. */
export async function previewDuplicateMerge(
  input: MergeInput,
): Promise<MergeDuplicateResult> {
  try {
    await getDb().transaction(async (tx) => {
      const result = await runMerge(tx, {
        ...input,
        actorHqUserId: null,
        sessionId: null,
      });
      throw new DryRunRollback(result);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
  throw new Error("merge preview did not roll back");
}

async function syncMergeToAshed(input: {
  allianceId: string;
  keptAshedMemberId: string;
  duplicateAshedMemberId: string;
}): Promise<void> {
  const ashedAllianceId = await getAshedAllianceIdIfLinked(input.allianceId);
  if (!ashedAllianceId || isSyntheticNativeAshedAllianceId(ashedAllianceId)) return;
  const connection = await resolveAllianceAshedBotConnection(input.allianceId);
  if (!connection) return;

  const rows = await getDb()
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      ashedAllianceId: schema.allianceMembers.ashedAllianceId,
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        inArray(schema.allianceMembers.ashedMemberId, [
          input.keptAshedMemberId,
          input.duplicateAshedMemberId,
        ]),
      ),
    );
  for (const row of rows) {
    if (row.ashedAllianceId !== ashedAllianceId) continue;
    try {
      if (row.ashedMemberId === input.keptAshedMemberId) {
        await syncMemberNameToAshed(
          connection,
          row.ashedMemberId,
          row.currentName,
          row.previousNamesJson ?? [],
        );
      } else {
        await markAshedMemberFormer({ connection, ashedMemberId: row.ashedMemberId });
      }
    } catch (error) {
      console.error(
        `[merge-duplicate] Ashed write failed for alliance ${input.allianceId}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }
}

export async function mergeDuplicateCommander(
  input: MergeInput & { actorHqUserId: string | null; sessionId: string | null },
): Promise<MergeDuplicateResult> {
  const result = await getDb().transaction((tx) => runMerge(tx, input));
  if (!result.ok) return result;

  await syncMergeToAshed(input);
  const { pruneFormerMembersFromOpenPools } = await import("@/lib/trains/pool");
  await pruneFormerMembersFromOpenPools(input.allianceId);
  return result;
}

export async function allianceHasRosterMember(
  allianceId: string,
  ashedMemberId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.allianceMembers.id })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function listDuplicateMergeCandidates(input: {
  allianceId: string;
  keptAshedMemberId: string;
}): Promise<Array<{ ashedMemberId: string; currentName: string }>> {
  return getDb()
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        ne(schema.allianceMembers.status, "former"),
        ne(schema.allianceMembers.ashedMemberId, input.keptAshedMemberId),
      ),
    )
    .orderBy(asc(schema.allianceMembers.currentName));
}