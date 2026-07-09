import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { MyEngTeamContext, MyWlTeamContext, WlSuggestion } from "./types";
import {
  createEngAssignment,
  getActiveAssignmentsForTeam,
  getCommanderAllianceProfession,
  getEngActiveAssignment,
  getEngAssignment,
  getOfficerWlOverview,
  getProfessionSince,
  getRecentWlTeamEvents,
  getWlSuggestions,
  getWlTeam,
  logWlTeamEvent,
  updateAssignmentStatus,
  updateCoverageWindow,
  upsertWlTeam,
} from "./repository";
import { notifyProfessionEvent } from "./notifications.server";

// ---------------------------------------------------------------------------
// Commander resolution helpers
// ---------------------------------------------------------------------------

/** Resolve the primary commander id for an HQ user in a specific alliance. */
export async function resolveCommanderForHqUser(
  hqUserId: string,
  allianceId: string,
): Promise<{ commanderId: string; profession: string | null } | null> {
  const db = getDb();
  // Get primary commander for this HQ user
  const [link] = await db
    .select({ commanderId: schema.hqUserCommanders.commanderId })
    .from(schema.hqUserCommanders)
    .where(
      and(
        eq(schema.hqUserCommanders.hqUserId, hqUserId),
        eq(schema.hqUserCommanders.isPrimary, true),
      ),
    )
    .limit(1);

  if (!link) return null;

  // Verify this commander is a member of the alliance
  const [membership] = await db
    .select({ commanderId: schema.commanderAllianceMemberships.commanderId })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.commanderId, link.commanderId),
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!membership) return null;

  // Load profession
  const [commander] = await db
    .select({ profession: schema.commanders.profession })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, link.commanderId))
    .limit(1);

  return {
    commanderId: link.commanderId,
    profession: commander?.profession ?? null,
  };
}

/** Resolve commander for a Discord user id. */
export async function resolveCommanderForDiscordUser(
  discordUserId: string,
  allianceId: string,
): Promise<{ commanderId: string; profession: string | null } | null> {
  const db = getDb();
  // Discord user → HQ user link
  const [discordLink] = await db
    .select({ hqUserId: schema.discordHqLinks.hqUserId })
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.discordUserId, discordUserId))
    .limit(1);

  if (!discordLink?.hqUserId) return null;
  return resolveCommanderForHqUser(discordLink.hqUserId, allianceId);
}

/** Update a commander's profession (for /switch-profession bot command). */
export async function updateCommanderProfession(
  commanderId: string,
  profession: "Engineer" | "War Leader",
  allianceId?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.commanders)
    .set({ profession, updatedAt: new Date() })
    .where(eq(schema.commanders.id, commanderId));

  if (allianceId) {
    await logWlTeamEvent({
      allianceId,
      eventKind: "profession_switched",
      actorCommanderId: commanderId,
      details: { to: profession, firstSet: true },
    });
  }
}

// ---------------------------------------------------------------------------
// Eng flows
// ---------------------------------------------------------------------------

/** Get the Eng's current team context. */
export async function getMyEngTeam(
  allianceId: string,
  engCommanderId: string,
): Promise<MyEngTeamContext> {
  const db = getDb();
  const [alliance] = await db
    .select({ wlMinEngsPerTeam: schema.alliances.wlMinEngsPerTeam })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const minEngsPerTeam = alliance?.wlMinEngsPerTeam ?? 2;
  const assignment = await getEngActiveAssignment(allianceId, engCommanderId);
  const teamEngs = assignment
    ? await getActiveAssignmentsForTeam(assignment.wlTeamId)
    : [];
  const teamEngCount = teamEngs.length;
  const since = await getProfessionSince(allianceId, engCommanderId);

  return {
    assignment: assignment
      ? {
          assignmentId: assignment.assignmentId,
          wlTeamId: assignment.wlTeamId,
          wlCommanderId: assignment.wlCommanderId,
          wlName: assignment.wlName,
          assignedAt: assignment.assignedAt,
          coverageStartHour: assignment.coverageStartHour,
          coverageEndHour: assignment.coverageEndHour,
        }
      : null,
    teamEngs,
    teamEngCount,
    minEngsPerTeam,
    professionSince: since?.toISOString() ?? null,
  };
}

/** Get WL suggestions for an Eng. */
export async function getSuggestionsForEng(
  allianceId: string,
  engCommanderId: string,
): Promise<WlSuggestion[]> {
  const db = getDb();
  const [alliance] = await db
    .select({ wlMinEngsPerTeam: schema.alliances.wlMinEngsPerTeam })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  // Find any WLs the Eng is already assigned to
  const activeAssignment = await getEngActiveAssignment(allianceId, engCommanderId);
  const excludeWlCommanderIds = activeAssignment
    ? [activeAssignment.wlCommanderId]
    : [];

  return getWlSuggestions({
    allianceId,
    excludeWlCommanderIds,
    minEngsPerTeam: alliance?.wlMinEngsPerTeam ?? 2,
    limit: 10,
  });
}

async function assertCommanderAllianceProfession(
  allianceId: string,
  commanderId: string,
  expectedProfession: "Engineer" | "War Leader",
): Promise<void> {
  const membership = await getCommanderAllianceProfession(allianceId, commanderId);
  if (!membership) {
    throw new Error("Commander is not a member of this alliance.");
  }
  if (membership.profession !== expectedProfession) {
    throw new Error(`Commander must be a ${expectedProfession}.`);
  }
}

/** Assign an Eng to a WL team. Creates the team if it doesn't exist. */
export async function assignEngToWl(input: {
  allianceId: string;
  engCommanderId: string;
  wlCommanderId: string;
}): Promise<{ assignmentId: string; wlTeamId: string }> {
  await assertCommanderAllianceProfession(
    input.allianceId,
    input.engCommanderId,
    "Engineer",
  );
  await assertCommanderAllianceProfession(
    input.allianceId,
    input.wlCommanderId,
    "War Leader",
  );

  const existingActive = await getEngActiveAssignment(
    input.allianceId,
    input.engCommanderId,
  );
  if (existingActive) {
    if (existingActive.wlCommanderId === input.wlCommanderId) {
      throw new Error("Engineer is already assigned to this War Leader's team.");
    }
    throw new Error("Engineer is already assigned to another War Leader's team.");
  }

  // Ensure WL team exists
  const wlTeamId = await upsertWlTeam(input.allianceId, input.wlCommanderId);

  // Check if already assigned on this team (inactive row re-activation guard)
  const existing = await getEngAssignment(wlTeamId, input.engCommanderId);
  if (existing?.status === "active") {
    throw new Error("Engineer is already assigned to this War Leader's team.");
  }

  // Create new assignment
  const assignmentId = await createEngAssignment({
    wlTeamId,
    allianceId: input.allianceId,
    engCommanderId: input.engCommanderId,
  });

  await logWlTeamEvent({
    allianceId: input.allianceId,
    wlTeamId,
    eventKind: "eng_assigned",
    actorCommanderId: input.engCommanderId,
    subjectCommanderId: input.wlCommanderId,
  });

  // Notify both parties
  await notifyProfessionEvent({
    kind: "eng_assigned",
    allianceId: input.allianceId,
    engCommanderId: input.engCommanderId,
    wlCommanderId: input.wlCommanderId,
  });

  return { assignmentId, wlTeamId };
}

/** Eng self-removes from their current WL team. */
export async function selfRemoveEng(
  allianceId: string,
  engCommanderId: string,
): Promise<void> {
  const assignment = await getEngActiveAssignment(allianceId, engCommanderId);
  if (!assignment) {
    throw new Error("No active assignment found.");
  }

  await updateAssignmentStatus(assignment.assignmentId, "self_removed");
  await logWlTeamEvent({
    allianceId,
    wlTeamId: assignment.wlTeamId,
    eventKind: "eng_self_removed",
    actorCommanderId: engCommanderId,
    subjectCommanderId: assignment.wlCommanderId,
  });

  await notifyProfessionEvent({
    kind: "eng_self_removed",
    allianceId,
    engCommanderId,
    wlCommanderId: assignment.wlCommanderId,
  });
}

/** Eng updates their coverage window. */
export async function setEngCoverageWindow(
  allianceId: string,
  engCommanderId: string,
  coverageStartHour: number | null,
  coverageEndHour: number | null,
): Promise<void> {
  const assignment = await getEngActiveAssignment(allianceId, engCommanderId);
  if (!assignment) {
    throw new Error("No active assignment found.");
  }
  await updateCoverageWindow(
    assignment.assignmentId,
    coverageStartHour,
    coverageEndHour,
  );
}

// ---------------------------------------------------------------------------
// WL flows
// ---------------------------------------------------------------------------

/** Get the WL's team intelligence context. */
export async function getMyWlTeam(
  allianceId: string,
  wlCommanderId: string,
): Promise<MyWlTeamContext> {
  const db = getDb();
  const [alliance] = await db
    .select({ wlMinEngsPerTeam: schema.alliances.wlMinEngsPerTeam })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const minEngsPerTeam = alliance?.wlMinEngsPerTeam ?? 2;
  const team = await getWlTeam(allianceId, wlCommanderId);
  const since = await getProfessionSince(allianceId, wlCommanderId);

  if (!team) {
    return {
      wlTeamId: null,
      activeEngs: [],
      minEngsPerTeam,
      isCovered: false,
      professionSince: since?.toISOString() ?? null,
    };
  }

  const activeEngs = await getActiveAssignmentsForTeam(team.id);
  return {
    wlTeamId: team.id,
    activeEngs,
    minEngsPerTeam,
    isCovered: activeEngs.length >= minEngsPerTeam,
    professionSince: since?.toISOString() ?? null,
  };
}

/** WL dismisses an Engineer from their team. */
export async function dismissEng(input: {
  allianceId: string;
  wlCommanderId: string;
  engCommanderId: string;
}): Promise<void> {
  const team = await getWlTeam(input.allianceId, input.wlCommanderId);
  if (!team) throw new Error("No team found for this War Leader.");

  const assignment = await getEngAssignment(team.id, input.engCommanderId);
  if (!assignment || assignment.status !== "active") {
    throw new Error("Engineer is not actively assigned to this team.");
  }

  await updateAssignmentStatus(
    assignment.id,
    "dismissed",
    input.wlCommanderId,
  );

  await logWlTeamEvent({
    allianceId: input.allianceId,
    wlTeamId: team.id,
    eventKind: "eng_dismissed",
    actorCommanderId: input.wlCommanderId,
    subjectCommanderId: input.engCommanderId,
  });

  await notifyProfessionEvent({
    kind: "eng_dismissed",
    allianceId: input.allianceId,
    engCommanderId: input.engCommanderId,
    wlCommanderId: input.wlCommanderId,
  });
}

/** WL requests more Engineers. Logs the event and posts to profession channel. */
export async function requestMoreEngs(
  allianceId: string,
  wlCommanderId: string,
): Promise<void> {
  const team = await getWlTeam(allianceId, wlCommanderId);

  await logWlTeamEvent({
    allianceId,
    wlTeamId: team?.id ?? null,
    eventKind: "more_engs_requested",
    actorCommanderId: wlCommanderId,
  });

  await notifyProfessionEvent({
    kind: "more_engs_requested",
    allianceId,
    wlCommanderId,
  });
}

// ---------------------------------------------------------------------------
// Profession switching
// ---------------------------------------------------------------------------

/**
 * Handle a profession switch. For WLs switching to Eng:
 * - Dismisses all active Engs and notifies them
 * For Engs switching to WL:
 * - Self-removes from current WL team if assigned
 */
export async function switchProfession(input: {
  allianceId: string;
  commanderId: string;
  fromProfession: "Engineer" | "War Leader";
  toProfession: "Engineer" | "War Leader";
}): Promise<{ freedEngs: string[] }> {
  const freedEngs: string[] = [];

  if (input.fromProfession === "War Leader") {
    // Free all active assigned Engs
    const team = await getWlTeam(input.allianceId, input.commanderId);
    if (team) {
      const activeEngs = await getActiveAssignmentsForTeam(team.id);
      for (const eng of activeEngs) {
        await updateAssignmentStatus(eng.assignmentId, "dismissed", input.commanderId);
        freedEngs.push(eng.engCommanderId);

        await notifyProfessionEvent({
          kind: "eng_dismissed",
          allianceId: input.allianceId,
          engCommanderId: eng.engCommanderId,
          wlCommanderId: input.commanderId,
          reason: "WL switched profession",
        });
      }
    }
  } else if (input.fromProfession === "Engineer") {
    // Self-remove from current WL team if assigned
    const assignment = await getEngActiveAssignment(
      input.allianceId,
      input.commanderId,
    );
    if (assignment) {
      await updateAssignmentStatus(assignment.assignmentId, "self_removed");
    }
  }

  // Update profession
  await updateCommanderProfession(input.commanderId, input.toProfession);

  await logWlTeamEvent({
    allianceId: input.allianceId,
    eventKind: "profession_switched",
    actorCommanderId: input.commanderId,
    details: { from: input.fromProfession, to: input.toProfession },
  });

  await notifyProfessionEvent({
    kind: "profession_switched",
    allianceId: input.allianceId,
    commanderId: input.commanderId,
    from: input.fromProfession,
    to: input.toProfession,
  });

  return { freedEngs };
}

/** Randomly assign an Eng to an under-covered WL team. */
export async function assignEngToRandomWl(
  allianceId: string,
  engCommanderId: string,
): Promise<{ wlCommanderId: string; wlName: string | null }> {
  const suggestions = await getSuggestionsForEng(allianceId, engCommanderId);
  if (suggestions.length === 0) {
    throw new Error("No War Leaders available for assignment.");
  }

  const minCount = Math.min(...suggestions.map((s) => s.activeEngCount));
  const candidates = suggestions.filter((s) => s.activeEngCount === minCount);
  const pick = candidates[Math.floor(Math.random() * candidates.length)]!;

  await assignEngToWl({
    allianceId,
    engCommanderId,
    wlCommanderId: pick.wlCommanderId,
  });

  return { wlCommanderId: pick.wlCommanderId, wlName: pick.wlName };
}

/** Officer assigns an Eng to a WL team. */
export async function officerAssignEng(input: {
  allianceId: string;
  engCommanderId: string;
  wlCommanderId: string;
}): Promise<void> {
  await assignEngToWl(input);
}

/** Officer sets a commander's profession. */
export async function officerSetProfession(input: {
  allianceId: string;
  commanderId: string;
  toProfession: "Engineer" | "War Leader";
}): Promise<void> {
  const db = getDb();
  const [commander] = await db
    .select({ profession: schema.commanders.profession })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, input.commanderId))
    .limit(1);

  if (!commander) throw new Error("Commander not found.");

  const membership = await getCommanderAllianceProfession(
    input.allianceId,
    input.commanderId,
  );
  if (!membership) {
    throw new Error("Commander is not a member of this alliance.");
  }

  const from = commander.profession as "Engineer" | "War Leader" | null;
  if (from === input.toProfession) {
    throw new Error("Commander already has this profession.");
  }

  if (from) {
    await switchProfession({
      allianceId: input.allianceId,
      commanderId: input.commanderId,
      fromProfession: from,
      toProfession: input.toProfession,
    });
  } else {
    await updateCommanderProfession(
      input.commanderId,
      input.toProfession,
      input.allianceId,
    );
  }
}

// ---------------------------------------------------------------------------
// Officer
// ---------------------------------------------------------------------------

export async function getOfficerProfessionPortal(allianceId: string) {
  const db = getDb();
  const [alliance] = await db
    .select({ wlMinEngsPerTeam: schema.alliances.wlMinEngsPerTeam })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const minEngsPerTeam = alliance?.wlMinEngsPerTeam ?? 2;
  const [overview, recentEvents] = await Promise.all([
    getOfficerWlOverview(allianceId, minEngsPerTeam),
    getRecentWlTeamEvents(allianceId, 50),
  ]);

  const totalWls = overview.wlRows.length;
  const coveredWls = overview.wlRows.filter((r) => r.isCovered).length;

  return {
    minEngsPerTeam,
    totalWls,
    coveredWls,
    wlRows: overview.wlRows,
    unassignedEngs: overview.unassignedEngs,
    recentEvents,
  };
}
