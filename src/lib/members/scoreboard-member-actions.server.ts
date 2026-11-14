import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { loadAshedConnectionForAllianceCapability } from "@/lib/ashed/load-ashed-connection.server";
import { base44ListMembers } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { createAshedMember } from "@/lib/members/ashed-member-write.server";
import { syncCommanderFromAllianceMember } from "@/lib/members/commander-identity.server";
import { syncMemberNameToAshed } from "@/lib/members/member-name-sync.server";
import { withScoreboardMemberCreateLock } from "@/lib/members/scoreboard-member-create-lock.server";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";
import {
  nextPreviousNames,
  normalizeScoreboardMemberName,
  SCOREBOARD_MANUAL_MATCH_METHOD,
  scoreboardAshedNameSuggestions,
  trimScoreboardConfirmedName,
  type ScoreboardAshedNameSuggestion,
  type ScoreboardMemberActionRowInput,
} from "@/lib/video/scoreboard-member-actions.shared";

export type ScoreboardMemberActionResult = {
  members: Array<{
    id: string;
    current_name: string;
    previous_names: string[];
  }>;
  rows: Array<{
    id: string;
    memberId: string;
    memberName: string;
    matchMethod: string;
    matchConfidence: number;
  }>;
};

export type ScoreboardMemberPreviewResult = {
  rows: Array<{
    id: string;
    confirmedName: string;
    exact: ScoreboardAshedNameSuggestion | null;
    suggestions: ScoreboardAshedNameSuggestion[];
  }>;
};

type ParsedScoreboardRow = {
  id: string;
  ocrName: string;
  memberId: string | null;
  memberName: string | null;
  matchMethod: string | null;
  deleted: number;
};

type ScoreboardDb = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update"
>;

type AshedMemberSnapshot = {
  id: string;
  current_name: string;
};

function normalizeActionRows(
  rows: ScoreboardMemberActionRowInput[],
): Map<string, ScoreboardMemberActionRowInput> {
  const byId = new Map<string, ScoreboardMemberActionRowInput>();
  for (const row of rows) {
    const confirmedName = trimScoreboardConfirmedName(row.confirmedName);
    if (!row.id || !normalizeScoreboardMemberName(confirmedName)) continue;
    byId.set(row.id, {
      id: row.id,
      confirmedName,
      bindAshedMemberId: row.bindAshedMemberId?.trim() || undefined,
      nameOverride: row.nameOverride === true,
    });
  }
  return byId;
}

async function lockParsedRowsForJob(
  db: ScoreboardDb,
  input: {
    parseSessionId: string;
    rowIds: string[];
  },
): Promise<ParsedScoreboardRow[]> {
  if (input.rowIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.parsedRows.id,
      ocrName: schema.parsedRows.ocrName,
      memberId: schema.parsedRows.memberId,
      memberName: schema.parsedRows.memberName,
      matchMethod: schema.parsedRows.matchMethod,
      deleted: schema.parsedRows.deleted,
    })
    .from(schema.parsedRows)
    .where(
      and(
        eq(schema.parsedRows.parseSessionId, input.parseSessionId),
        inArray(schema.parsedRows.id, input.rowIds),
      ),
    )
    .orderBy(asc(schema.parsedRows.id))
    .for("update");
  return rows.filter((row) => row.deleted !== 1);
}

async function persistParsedRowMatch(
  db: ScoreboardDb,
  input: {
    rowId: string;
    memberId: string;
    memberName: string;
    matchMethod: string;
  },
): Promise<void> {
  await db
    .update(schema.parsedRows)
    .set({
      memberId: input.memberId,
      memberName: input.memberName,
      matchConfidence: 1,
      matchMethod: input.matchMethod,
      edited: 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.parsedRows.id, input.rowId));
}

async function insertHqAllianceMember(
  db: ScoreboardDb,
  input: {
    allianceId: string;
    ashedMemberId: string;
    ashedAllianceId: string;
    currentName: string;
    previousNames?: string[];
  },
): Promise<void> {
  const now = new Date();
  await db.insert(schema.allianceMembers).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    ashedAllianceId: input.ashedAllianceId,
    currentName: input.currentName,
    previousNamesJson: input.previousNames ?? [],
    status: "active",
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function findHqMemberIdByNormalizedName(
  db: ScoreboardDb,
  allianceId: string,
  normalizedName: string,
): Promise<string | null> {
  const roster = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(eq(schema.allianceMembers.allianceId, allianceId));
  const match = roster.find(
    (member) =>
      normalizeScoreboardMemberName(member.currentName) === normalizedName,
  );
  return match?.ashedMemberId ?? null;
}

async function findHqMemberIdByAshedId(
  db: ScoreboardDb,
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ ashedMemberId: schema.allianceMembers.ashedMemberId })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row?.ashedMemberId ?? null;
}

async function loadHqAshedMemberIds(
  db: ScoreboardDb,
  allianceId: string,
): Promise<Set<string>> {
  const roster = await db
    .select({ ashedMemberId: schema.allianceMembers.ashedMemberId })
    .from(schema.allianceMembers)
    .where(eq(schema.allianceMembers.allianceId, allianceId));
  return new Set(roster.map((row) => row.ashedMemberId));
}

async function loadAshedMembers(
  connection: ParsedConnection,
  ashedAllianceId: string,
): Promise<AshedMemberSnapshot[]> {
  const remote = await base44ListMembers(connection, ashedAllianceId);
  const out: AshedMemberSnapshot[] = [];
  for (const member of remote) {
    const name = trimScoreboardConfirmedName(member.current_name ?? "");
    if (!member.id || !normalizeScoreboardMemberName(name)) continue;
    out.push({ id: member.id, current_name: name });
  }
  return out;
}

function ashedIdByNormalizedName(
  members: AshedMemberSnapshot[],
): Map<string, string> {
  const byName = new Map<string, string>();
  for (const member of members) {
    const key = normalizeScoreboardMemberName(member.current_name);
    if (!key || byName.has(key)) continue;
    byName.set(key, member.id);
  }
  return byName;
}

function ashedMemberById(
  members: AshedMemberSnapshot[],
): Map<string, AshedMemberSnapshot> {
  return new Map(members.map((member) => [member.id, member]));
}

/**
 * Scoreboard create/rename must never call Ashed inside an open DB transaction.
 * Ashed HTTP is not transactional: success + later TX rollback orphans/duplicates
 * members (create) or permanently diverges names (rename).
 */
export async function previewScoreboardMemberCreates(input: {
  sessionId: string;
  allianceId: string;
  parseSessionId: string;
  rows: ScoreboardMemberActionRowInput[];
}): Promise<ScoreboardMemberPreviewResult> {
  const actionRows = normalizeActionRows(input.rows);
  if (actionRows.size === 0) {
    return { rows: [] };
  }

  const linkedAshedId = await getAshedAllianceIdIfLinked(input.allianceId);
  if (!linkedAshedId) {
    return {
      rows: [...actionRows.values()].map((row) => ({
        id: row.id,
        confirmedName: row.confirmedName,
        exact: null,
        suggestions: [],
      })),
    };
  }

  const connection = await loadAshedConnectionForAllianceCapability({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    capability: "roster:sync",
    delegatedAction: "scoreboard-member-create",
  });
  if (!connection) {
    throw new Error("Connect Ashed before creating members from a scoreboard.");
  }

  const db = getDb();
  const locked = await db.transaction(async (tx) => {
    const rows = await lockParsedRowsForJob(tx, {
      parseSessionId: input.parseSessionId,
      rowIds: [...actionRows.keys()],
    });
    return rows.filter((row) => !row.memberId && actionRows.has(row.id));
  });

  const hqIds = await loadHqAshedMemberIds(db, input.allianceId);
  const ashedMembers = await loadAshedMembers(connection, linkedAshedId);
  const candidates = ashedMembers.map((member) => ({
    id: member.id,
    name: member.current_name,
  }));

  return {
    rows: locked.map((row) => {
      const action = actionRows.get(row.id)!;
      const match = scoreboardAshedNameSuggestions(
        action.confirmedName,
        candidates,
        hqIds,
      );
      return {
        id: row.id,
        confirmedName: action.confirmedName,
        exact: match.exact,
        suggestions: match.suggestions,
      };
    }),
  };
}

export async function createScoreboardMembersFromReview(input: {
  sessionId: string;
  allianceId: string;
  parseSessionId: string;
  rows: ScoreboardMemberActionRowInput[];
}): Promise<ScoreboardMemberActionResult> {
  const actionRows = normalizeActionRows(input.rows);
  if (actionRows.size === 0) {
    return { members: [], rows: [] };
  }

  const ashedAllianceId =
    (await getAshedAllianceIdIfLinked(input.allianceId)) ??
    nativeRosterAshedAllianceId(input.allianceId);
  const connection = await loadAshedConnectionForAllianceCapability({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    capability: "roster:sync",
    delegatedAction: "scoreboard-member-create",
  });
  const linkedAshedId = await getAshedAllianceIdIfLinked(input.allianceId);
  if (linkedAshedId && !connection) {
    throw new Error("Connect Ashed before creating members from a scoreboard.");
  }

  const db = getDb();

  // Snapshot unmatched rows under row locks, then release before any Ashed HTTP.
  const unmatched = await db.transaction(async (tx) => {
    const rows = await lockParsedRowsForJob(tx, {
      parseSessionId: input.parseSessionId,
      rowIds: [...actionRows.keys()],
    });
    return rows.filter((row) => !row.memberId && actionRows.has(row.id));
  });
  if (unmatched.length === 0) {
    return { members: [], rows: [] };
  }

  const ashedMembers =
    linkedAshedId && connection
      ? await loadAshedMembers(connection, linkedAshedId)
      : [];
  const ashedIdByName = ashedIdByNormalizedName(ashedMembers);
  const ashedById = ashedMemberById(ashedMembers);

  const members: ScoreboardMemberActionResult["members"] = [];
  const patchedRows: ScoreboardMemberActionResult["rows"] = [];
  const ashedRenameSync: Array<{
    memberId: string;
    nextName: string;
    nextPrevious: string[];
  }> = [];

  type WorkItem = {
    key: string;
    confirmedName: string;
    bindAshedMemberId?: string;
    nameOverride: boolean;
    rows: ParsedScoreboardRow[];
  };

  const work = new Map<string, WorkItem>();
  for (const row of unmatched) {
    const action = actionRows.get(row.id)!;
    const bindId = action.bindAshedMemberId;
    const key = bindId
      ? `bind:${bindId}:${action.nameOverride ? "override" : "keep"}:${normalizeScoreboardMemberName(action.confirmedName)}`
      : `create:${normalizeScoreboardMemberName(action.confirmedName)}`;
    const existing = work.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      work.set(key, {
        key,
        confirmedName: action.confirmedName,
        bindAshedMemberId: bindId,
        nameOverride: action.nameOverride === true,
        rows: [row],
      });
    }
  }

  for (const group of work.values()) {
    const lockName = group.bindAshedMemberId
      ? `bind:${group.bindAshedMemberId}`
      : normalizeScoreboardMemberName(group.confirmedName);

    await withScoreboardMemberCreateLock(
      { allianceId: input.allianceId, normalizedName: lockName },
      async () => {
        if (group.bindAshedMemberId) {
          const remote = ashedById.get(group.bindAshedMemberId);
          if (!remote) {
            throw new Error(
              "Suggested Ashed member was not found. Refresh and try again.",
            );
          }

          const ashedCurrentName = remote.current_name;
          const nextName = group.nameOverride
            ? group.confirmedName
            : ashedCurrentName;
          const nextPrevious = group.nameOverride
            ? nextPreviousNames(ashedCurrentName, [], nextName)
            : [];

          let memberId = await findHqMemberIdByAshedId(
            db,
            input.allianceId,
            group.bindAshedMemberId,
          );
          let createdNow = false;

          if (!memberId) {
            memberId = group.bindAshedMemberId;
            createdNow = true;
          }

          await db.transaction(async (tx) => {
            const existingId = await findHqMemberIdByAshedId(
              tx,
              input.allianceId,
              group.bindAshedMemberId!,
            );
            const resolvedId = existingId ?? memberId!;

            if (!existingId) {
              await insertHqAllianceMember(tx, {
                allianceId: input.allianceId,
                ashedMemberId: resolvedId,
                ashedAllianceId,
                currentName: nextName,
                previousNames: nextPrevious,
              });
              members.push({
                id: resolvedId,
                current_name: nextName,
                previous_names: nextPrevious,
              });
            } else if (group.nameOverride) {
              const [existing] = await tx
                .select()
                .from(schema.allianceMembers)
                .where(
                  and(
                    eq(schema.allianceMembers.allianceId, input.allianceId),
                    eq(schema.allianceMembers.ashedMemberId, resolvedId),
                  ),
                )
                .limit(1)
                .for("update");
              if (existing) {
                const previousNames = existing.previousNamesJson ?? [];
                const mergedPrevious = nextPreviousNames(
                  existing.currentName,
                  previousNames,
                  nextName,
                );
                if (
                  existing.currentName !== nextName ||
                  mergedPrevious !== previousNames
                ) {
                  await tx
                    .update(schema.allianceMembers)
                    .set({
                      currentName: nextName,
                      previousNamesJson: mergedPrevious,
                      updatedAt: new Date(),
                    })
                    .where(eq(schema.allianceMembers.id, existing.id));
                  members.push({
                    id: resolvedId,
                    current_name: nextName,
                    previous_names: mergedPrevious,
                  });
                  if (linkedAshedId && connection) {
                    ashedRenameSync.push({
                      memberId: resolvedId,
                      nextName,
                      nextPrevious: mergedPrevious,
                    });
                  }
                }
              }
            }

            if (
              createdNow &&
              group.nameOverride &&
              linkedAshedId &&
              connection
            ) {
              ashedRenameSync.push({
                memberId: resolvedId,
                nextName,
                nextPrevious,
              });
            }

            for (const row of group.rows) {
              const [fresh] = await tx
                .select({
                  id: schema.parsedRows.id,
                  memberId: schema.parsedRows.memberId,
                  memberName: schema.parsedRows.memberName,
                  matchMethod: schema.parsedRows.matchMethod,
                })
                .from(schema.parsedRows)
                .where(eq(schema.parsedRows.id, row.id))
                .limit(1)
                .for("update");
              if (fresh?.memberId) {
                patchedRows.push({
                  id: row.id,
                  memberId: fresh.memberId,
                  memberName: fresh.memberName ?? nextName,
                  matchMethod: fresh.matchMethod ?? "exact",
                  matchConfidence: 1,
                });
                continue;
              }

              await persistParsedRowMatch(tx, {
                rowId: row.id,
                memberId: resolvedId,
                memberName: nextName,
                matchMethod: "exact",
              });
              patchedRows.push({
                id: row.id,
                memberId: resolvedId,
                memberName: nextName,
                matchMethod: "exact",
                matchConfidence: 1,
              });
            }
          });
          return;
        }

        const key = normalizeScoreboardMemberName(group.confirmedName);
        let ashedMemberId =
          (await findHqMemberIdByNormalizedName(db, input.allianceId, key)) ??
          undefined;
        let createdNow = false;

        if (!ashedMemberId) {
          if (linkedAshedId && connection) {
            ashedMemberId = ashedIdByName.get(key);
            if (!ashedMemberId) {
              // Ashed create happens outside any DB transaction.
              ashedMemberId = await createAshedMember({
                connection,
                ashedAllianceId: linkedAshedId,
                currentName: group.confirmedName,
              });
              ashedIdByName.set(key, ashedMemberId);
            }
          } else {
            ashedMemberId = nanoid(16);
          }
          createdNow = true;
        }

        await db.transaction(async (tx) => {
          const existingId = await findHqMemberIdByNormalizedName(
            tx,
            input.allianceId,
            key,
          );
          const memberId = existingId ?? ashedMemberId!;

          if (!existingId) {
            await insertHqAllianceMember(tx, {
              allianceId: input.allianceId,
              ashedMemberId: memberId,
              ashedAllianceId,
              currentName: group.confirmedName,
            });
            if (createdNow) {
              members.push({
                id: memberId,
                current_name: group.confirmedName,
                previous_names: [],
              });
            }
          }

          for (const row of group.rows) {
            const [fresh] = await tx
              .select({
                id: schema.parsedRows.id,
                memberId: schema.parsedRows.memberId,
                memberName: schema.parsedRows.memberName,
                matchMethod: schema.parsedRows.matchMethod,
              })
              .from(schema.parsedRows)
              .where(eq(schema.parsedRows.id, row.id))
              .limit(1)
              .for("update");
            if (fresh?.memberId) {
              patchedRows.push({
                id: row.id,
                memberId: fresh.memberId,
                memberName: fresh.memberName ?? group.confirmedName,
                matchMethod: fresh.matchMethod ?? "exact",
                matchConfidence: 1,
              });
              continue;
            }

            await persistParsedRowMatch(tx, {
              rowId: row.id,
              memberId,
              memberName: group.confirmedName,
              matchMethod: "exact",
            });
            patchedRows.push({
              id: row.id,
              memberId,
              memberName: group.confirmedName,
              matchMethod: "exact",
              matchConfidence: 1,
            });
          }
        });
      },
    );
  }

  if (connection) {
    for (const item of ashedRenameSync) {
      await syncMemberNameToAshed(
        connection,
        item.memberId,
        item.nextName,
        item.nextPrevious,
      );
    }
  }

  for (const member of members) {
    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId: member.id,
      memberDisplayName: member.current_name,
    });
  }

  return { members, rows: patchedRows };
}

export async function applyScoreboardMemberNamesFromReview(input: {
  sessionId: string;
  allianceId: string;
  parseSessionId: string;
  rows: ScoreboardMemberActionRowInput[];
}): Promise<ScoreboardMemberActionResult> {
  const actionRows = normalizeActionRows(input.rows);
  if (actionRows.size === 0) {
    return { members: [], rows: [] };
  }

  const connection = await loadAshedConnectionForAllianceCapability({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    capability: "roster:sync",
    delegatedAction: "scoreboard-member-rename",
  });
  const linkedAshedId = await getAshedAllianceIdIfLinked(input.allianceId);
  if (linkedAshedId && !connection) {
    throw new Error(
      "Connect Ashed before updating member names from a scoreboard.",
    );
  }

  const db = getDb();
  const commanderSync: Array<{ memberId: string; nextName: string }> = [];
  const ashedSync: Array<{
    memberId: string;
    nextName: string;
    nextPrevious: string[];
  }> = [];

  // HQ commit first. Ashed rename runs only after the transaction commits so a
  // rolled-back TX cannot leave Ashed ahead of HQ.
  const result = await db.transaction(async (tx) => {
    const rows = await lockParsedRowsForJob(tx, {
      parseSessionId: input.parseSessionId,
      rowIds: [...actionRows.keys()],
    });
    const renameRows = rows.filter(
      (row) =>
        row.memberId &&
        row.matchMethod === SCOREBOARD_MANUAL_MATCH_METHOD &&
        actionRows.has(row.id),
    );
    if (renameRows.length === 0) {
      return { members: [], rows: [] } satisfies ScoreboardMemberActionResult;
    }

    const grouped = new Map<
      string,
      { nextName: string; rows: ParsedScoreboardRow[] }
    >();
    for (const row of renameRows) {
      const memberId = row.memberId!;
      const nextName = actionRows.get(row.id)!.confirmedName;
      const existing = grouped.get(memberId);
      if (existing) {
        existing.rows.push(row);
      } else {
        grouped.set(memberId, { nextName, rows: [row] });
      }
    }

    const members: ScoreboardMemberActionResult["members"] = [];
    const patchedRows: ScoreboardMemberActionResult["rows"] = [];

    for (const [memberId, group] of grouped) {
      const nextName = group.nextName;
      const [existing] = await tx
        .select()
        .from(schema.allianceMembers)
        .where(
          and(
            eq(schema.allianceMembers.allianceId, input.allianceId),
            eq(schema.allianceMembers.ashedMemberId, memberId),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing) {
        throw new Error("Matched member not found.");
      }

      const previousNames = existing.previousNamesJson ?? [];
      const nextPrevious = nextPreviousNames(
        existing.currentName,
        previousNames,
        nextName,
      );
      const needsHqWrite =
        existing.currentName !== nextName || nextPrevious !== previousNames;

      if (needsHqWrite) {
        await tx
          .update(schema.allianceMembers)
          .set({
            currentName: nextName,
            previousNamesJson: nextPrevious,
            updatedAt: new Date(),
          })
          .where(eq(schema.allianceMembers.id, existing.id));
        commanderSync.push({ memberId, nextName });
        members.push({
          id: memberId,
          current_name: nextName,
          previous_names: nextPrevious,
        });
      }

      if (linkedAshedId && connection) {
        ashedSync.push({ memberId, nextName, nextPrevious });
      }

      for (const row of group.rows) {
        await persistParsedRowMatch(tx, {
          rowId: row.id,
          memberId,
          memberName: nextName,
          matchMethod: SCOREBOARD_MANUAL_MATCH_METHOD,
        });
        patchedRows.push({
          id: row.id,
          memberId,
          memberName: nextName,
          matchMethod: SCOREBOARD_MANUAL_MATCH_METHOD,
          matchConfidence: 1,
        });
      }
    }

    return { members, rows: patchedRows };
  });

  if (connection) {
    for (const item of ashedSync) {
      await syncMemberNameToAshed(
        connection,
        item.memberId,
        item.nextName,
        item.nextPrevious,
      );
    }
  }

  for (const item of commanderSync) {
    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId: item.memberId,
      memberDisplayName: item.nextName,
    });
  }

  return result;
}
