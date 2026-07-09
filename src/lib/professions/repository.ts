import "server-only";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  AssignedEngRow,
  OfficerActivityEvent,
  OfficerUnassignedEngRow,
  OfficerWlRow,
  WlEngAssignmentStatus,
  WlSuggestion,
  WlTeamEventKind,
} from "./types";

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** Find the WL team for a given (allianceId, wlCommanderId), or null. */
export async function getWlTeam(allianceId: string, wlCommanderId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.wlTeams)
    .where(
      and(
        eq(schema.wlTeams.allianceId, allianceId),
        eq(schema.wlTeams.wlCommanderId, wlCommanderId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Upsert a WL team row, returning the id. */
export async function upsertWlTeam(
  allianceId: string,
  wlCommanderId: string,
): Promise<string> {
  const db = getDb();
  const existing = await getWlTeam(allianceId, wlCommanderId);
  if (existing) return existing.id;
  const id = nanoid();
  await db.insert(schema.wlTeams).values({
    id,
    allianceId,
    wlCommanderId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** Get the active assignment for an Eng on a specific WL team. */
export async function getEngAssignment(wlTeamId: string, engCommanderId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.wlEngAssignments)
    .where(
      and(
        eq(schema.wlEngAssignments.wlTeamId, wlTeamId),
        eq(schema.wlEngAssignments.engCommanderId, engCommanderId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Get all active assignments for a WL team. */
export async function getActiveAssignmentsForTeam(
  wlTeamId: string,
): Promise<AssignedEngRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      assignmentId: schema.wlEngAssignments.id,
      engCommanderId: schema.wlEngAssignments.engCommanderId,
      engName: schema.commanders.primaryName,
      assignedAt: schema.wlEngAssignments.assignedAt,
      coverageStartHour: schema.wlEngAssignments.coverageStartHour,
      coverageEndHour: schema.wlEngAssignments.coverageEndHour,
      status: schema.wlEngAssignments.status,
    })
    .from(schema.wlEngAssignments)
    .leftJoin(
      schema.commanders,
      eq(schema.wlEngAssignments.engCommanderId, schema.commanders.id),
    )
    .where(
      and(
        eq(schema.wlEngAssignments.wlTeamId, wlTeamId),
        eq(schema.wlEngAssignments.status, "active"),
      ),
    )
    .orderBy(asc(schema.wlEngAssignments.assignedAt));

  return rows.map((r) => ({
    assignmentId: r.assignmentId,
    engCommanderId: r.engCommanderId,
    engName: r.engName,
    assignedAt: r.assignedAt,
    coverageStartHour: r.coverageStartHour,
    coverageEndHour: r.coverageEndHour,
    status: r.status as WlEngAssignmentStatus,
  }));
}

/** Count active Engs on a WL team. */
export async function countActiveEngsForTeam(wlTeamId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.wlEngAssignments)
    .where(
      and(
        eq(schema.wlEngAssignments.wlTeamId, wlTeamId),
        eq(schema.wlEngAssignments.status, "active"),
      ),
    );
  return row?.count ?? 0;
}

/** Get the active assignment for an Eng (across all WL teams in an alliance). */
export async function getEngActiveAssignment(
  allianceId: string,
  engCommanderId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({
      assignmentId: schema.wlEngAssignments.id,
      wlTeamId: schema.wlEngAssignments.wlTeamId,
      engCommanderId: schema.wlEngAssignments.engCommanderId,
      coverageStartHour: schema.wlEngAssignments.coverageStartHour,
      coverageEndHour: schema.wlEngAssignments.coverageEndHour,
      assignedAt: schema.wlEngAssignments.assignedAt,
      wlCommanderId: schema.wlTeams.wlCommanderId,
      wlName: schema.commanders.primaryName,
    })
    .from(schema.wlEngAssignments)
    .innerJoin(
      schema.wlTeams,
      eq(schema.wlEngAssignments.wlTeamId, schema.wlTeams.id),
    )
    .leftJoin(
      schema.commanders,
      eq(schema.wlTeams.wlCommanderId, schema.commanders.id),
    )
    .where(
      and(
        eq(schema.wlEngAssignments.allianceId, allianceId),
        eq(schema.wlEngAssignments.engCommanderId, engCommanderId),
        eq(schema.wlEngAssignments.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Create a new Eng assignment. Throws if Eng is already actively assigned to this team. */
export async function createEngAssignment(input: {
  wlTeamId: string;
  allianceId: string;
  engCommanderId: string;
}): Promise<string> {
  const db = getDb();
  const id = nanoid();
  await db.insert(schema.wlEngAssignments).values({
    id,
    wlTeamId: input.wlTeamId,
    allianceId: input.allianceId,
    engCommanderId: input.engCommanderId,
    status: "active",
    assignedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

/** Update the status of an assignment (dismiss or self-remove). */
export async function updateAssignmentStatus(
  assignmentId: string,
  status: "dismissed" | "self_removed",
  dismissedByCommanderId?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.wlEngAssignments)
    .set({
      status,
      dismissedAt: new Date(),
      dismissedByCommanderId: dismissedByCommanderId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.wlEngAssignments.id, assignmentId));
}

/** Update the coverage window for an assignment. */
export async function updateCoverageWindow(
  assignmentId: string,
  coverageStartHour: number | null,
  coverageEndHour: number | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.wlEngAssignments)
    .set({ coverageStartHour, coverageEndHour, updatedAt: new Date() })
    .where(eq(schema.wlEngAssignments.id, assignmentId));
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Returns WLs sorted by active Eng count ascending (most under-covered first).
 * Excludes the requesting Eng's already-assigned WLs.
 */
export async function getWlSuggestions(input: {
  allianceId: string;
  /** Exclude WLs this Eng is already assigned to. */
  excludeWlCommanderIds: string[];
  minEngsPerTeam: number;
  limit?: number;
}): Promise<WlSuggestion[]> {
  const db = getDb();

  // All WL commanders in this alliance via commanderAllianceMemberships
  const wlRows = await db
    .select({
      commanderId: schema.commanders.id,
      currentName: schema.commanders.primaryName,
    })
    .from(schema.commanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(schema.commanders.profession, "War Leader"),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  if (wlRows.length === 0) return [];

  const allWlCommanderIds = wlRows.map((r) => r.commanderId);

  if (allWlCommanderIds.length === 0) return [];

  // Load existing teams for all WLs
  const teams = await db
    .select({
      id: schema.wlTeams.id,
      wlCommanderId: schema.wlTeams.wlCommanderId,
    })
    .from(schema.wlTeams)
    .where(
      and(
        eq(schema.wlTeams.allianceId, input.allianceId),
        inArray(schema.wlTeams.wlCommanderId, allWlCommanderIds),
      ),
    );

  const teamByWlCommanderId = new Map(teams.map((t) => [t.wlCommanderId, t]));

  // Count active Engs per team
  const teamIds = teams.map((t) => t.id);
  const countsByTeamId = new Map<string, number>();
  if (teamIds.length > 0) {
    const counts = await db
      .select({
        wlTeamId: schema.wlEngAssignments.wlTeamId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.wlEngAssignments)
      .where(
        and(
          inArray(schema.wlEngAssignments.wlTeamId, teamIds),
          eq(schema.wlEngAssignments.status, "active"),
        ),
      )
      .groupBy(schema.wlEngAssignments.wlTeamId);

    for (const c of counts) {
      countsByTeamId.set(c.wlTeamId, c.count);
    }
  }

  const excludeSet = new Set(input.excludeWlCommanderIds);

  const suggestions: WlSuggestion[] = wlRows
    .filter((r) => !excludeSet.has(r.commanderId))
    .map((r) => {
      const team = teamByWlCommanderId.get(r.commanderId);
      const activeEngCount = team ? (countsByTeamId.get(team.id) ?? 0) : 0;
      return {
        wlCommanderId: r.commanderId,
        wlName: r.currentName,
        activeEngCount,
        isCovered: activeEngCount >= input.minEngsPerTeam,
        wlTeamId: team?.id ?? null,
      };
    });

  // Sort: under-covered first, then by name
  suggestions.sort((a, b) => {
    if (a.activeEngCount !== b.activeEngCount) {
      return a.activeEngCount - b.activeEngCount;
    }
    return (a.wlName ?? "").localeCompare(b.wlName ?? "");
  });

  return suggestions.slice(0, input.limit ?? 20);
}

// ---------------------------------------------------------------------------
// Officer overview
// ---------------------------------------------------------------------------

/** Build the officer-facing WL coverage overview for an alliance. */
export async function getOfficerWlOverview(
  allianceId: string,
  minEngsPerTeam: number,
): Promise<{ wlRows: OfficerWlRow[]; unassignedEngs: OfficerUnassignedEngRow[] }> {
  const db = getDb();

  // All WLs in the alliance via commanderAllianceMemberships
  const wlMembers = await db
    .select({
      commanderId: schema.commanders.id,
      currentName: schema.commanders.primaryName,
    })
    .from(schema.commanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanders.profession, "War Leader"),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  // All WL teams
  const teams = await db
    .select()
    .from(schema.wlTeams)
    .where(eq(schema.wlTeams.allianceId, allianceId));

  const teamByWlCommanderId = new Map(teams.map((t) => [t.wlCommanderId, t]));

  // Count active Engs per team
  const teamIds = teams.map((t) => t.id);
  const countsByTeamId = new Map<string, number>();
  if (teamIds.length > 0) {
    const counts = await db
      .select({
        wlTeamId: schema.wlEngAssignments.wlTeamId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.wlEngAssignments)
      .where(
        and(
          inArray(schema.wlEngAssignments.wlTeamId, teamIds),
          eq(schema.wlEngAssignments.status, "active"),
        ),
      )
      .groupBy(schema.wlEngAssignments.wlTeamId);

    for (const c of counts) {
      countsByTeamId.set(c.wlTeamId, c.count);
    }
  }

  const wlRows: OfficerWlRow[] = wlMembers
    .map((m) => {
      const team = teamByWlCommanderId.get(m.commanderId);
      const activeEngCount = team ? (countsByTeamId.get(team.id) ?? 0) : 0;
      return {
        wlCommanderId: m.commanderId,
        wlName: m.currentName,
        wlTeamId: team?.id ?? null,
        activeEngCount,
        minEngsPerTeam,
        isCovered: activeEngCount >= minEngsPerTeam,
      };
    })
    .sort((a, b) => {
      // Uncovered first, then by name
      if (a.isCovered !== b.isCovered) return a.isCovered ? 1 : -1;
      return (a.wlName ?? "").localeCompare(b.wlName ?? "");
    });

  // All Engs in the alliance via commanderAllianceMemberships
  const engMembers = await db
    .select({
      commanderId: schema.commanders.id,
      currentName: schema.commanders.primaryName,
    })
    .from(schema.commanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanders.profession, "Engineer"),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  const engCommanderIds = engMembers.map((m) => m.commanderId);

  const assignedEngIds = new Set<string>();
  const filteredEngIds = engCommanderIds.filter((id): id is string => Boolean(id));
  if (filteredEngIds.length > 0) {
    const assigned = await db
      .select({ engCommanderId: schema.wlEngAssignments.engCommanderId })
      .from(schema.wlEngAssignments)
      .where(
        and(
          eq(schema.wlEngAssignments.allianceId, allianceId),
          eq(schema.wlEngAssignments.status, "active"),
          inArray(schema.wlEngAssignments.engCommanderId, filteredEngIds),
        ),
      );
    for (const r of assigned) {
      assignedEngIds.add(r.engCommanderId);
    }
  }

  const unassignedEngs: OfficerUnassignedEngRow[] = engMembers
    .filter((m) => !assignedEngIds.has(m.commanderId))
    .map((m) => ({
      engCommanderId: m.commanderId,
      engName: m.currentName,
    }))
    .sort((a, b) => (a.engName ?? "").localeCompare(b.engName ?? ""));

  return { wlRows, unassignedEngs };
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/** Write an entry to the WL team activity log. */
export async function logWlTeamEvent(input: {
  allianceId: string;
  wlTeamId?: string | null;
  eventKind: WlTeamEventKind;
  actorCommanderId?: string | null;
  subjectCommanderId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.wlTeamEvents).values({
    id: nanoid(),
    allianceId: input.allianceId,
    wlTeamId: input.wlTeamId ?? null,
    eventKind: input.eventKind,
    actorCommanderId: input.actorCommanderId ?? null,
    subjectCommanderId: input.subjectCommanderId ?? null,
    detailsJson: input.details ?? null,
    createdAt: new Date(),
  });
}

/** Load recent activity events for the officer feed. */
export async function getRecentWlTeamEvents(
  allianceId: string,
  limit = 50,
): Promise<OfficerActivityEvent[]> {
  const db = getDb();

  const actorAlias = schema.commanders;

  // We need two joins on commanders (actor + subject) — use raw column refs
  const rows = await db
    .select({
      id: schema.wlTeamEvents.id,
      eventKind: schema.wlTeamEvents.eventKind,
      actorCommanderId: schema.wlTeamEvents.actorCommanderId,
      subjectCommanderId: schema.wlTeamEvents.subjectCommanderId,
      createdAt: schema.wlTeamEvents.createdAt,
      detailsJson: schema.wlTeamEvents.detailsJson,
    })
    .from(schema.wlTeamEvents)
    .where(eq(schema.wlTeamEvents.allianceId, allianceId))
    .orderBy(desc(schema.wlTeamEvents.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Resolve commander names in a second query
  const commanderIds = [
    ...new Set(
      rows.flatMap((r) =>
        [r.actorCommanderId, r.subjectCommanderId].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];

  const nameMap = new Map<string, string | null>();
  if (commanderIds.length > 0) {
    const names = await db
      .select({ id: actorAlias.id, primaryName: actorAlias.primaryName })
      .from(actorAlias)
      .where(inArray(actorAlias.id, commanderIds));
    for (const n of names) {
      nameMap.set(n.id, n.primaryName);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    eventKind: r.eventKind as OfficerActivityEvent["eventKind"],
    actorCommanderId: r.actorCommanderId,
    actorName: r.actorCommanderId ? (nameMap.get(r.actorCommanderId) ?? null) : null,
    subjectCommanderId: r.subjectCommanderId,
    subjectName: r.subjectCommanderId
      ? (nameMap.get(r.subjectCommanderId) ?? null)
      : null,
    createdAt: r.createdAt,
    details: r.detailsJson as Record<string, unknown> | null,
  }));
}

// ---------------------------------------------------------------------------
// Profession channels
// ---------------------------------------------------------------------------

/** Get registered Discord profession channel for an alliance's guild. */
export async function getProfessionChannel(allianceId: string, guildId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.professionChannels)
    .where(
      and(
        eq(schema.professionChannels.allianceId, allianceId),
        eq(schema.professionChannels.guildId, guildId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Upsert a profession channel registration. */
export async function upsertProfessionChannel(
  allianceId: string,
  guildId: string,
  channelId: string,
): Promise<void> {
  const db = getDb();
  const existing = await getProfessionChannel(allianceId, guildId);
  if (existing) {
    await db
      .update(schema.professionChannels)
      .set({ channelId, updatedAt: new Date() })
      .where(eq(schema.professionChannels.id, existing.id));
  } else {
    await db.insert(schema.professionChannels).values({
      id: nanoid(),
      allianceId,
      guildId,
      channelId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/** Get all registered profession channels for an alliance (may span multiple guilds). */
export async function getProfessionChannelsForAlliance(allianceId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.professionChannels)
    .where(eq(schema.professionChannels.allianceId, allianceId));
}
