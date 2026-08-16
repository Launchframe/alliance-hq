import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { loadAshedConnectionForAllianceCapability } from "@/lib/ashed/load-ashed-connection.server";
import { base44EntityPost } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { syncCommanderFromAllianceMember } from "@/lib/members/commander-identity.server";
import { syncMemberNameToAshed } from "@/lib/members/member-name-sync.server";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";
import {
  nextPreviousNames,
  normalizeScoreboardMemberName,
  SCOREBOARD_MANUAL_MATCH_METHOD,
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

type ParsedScoreboardRow = {
  id: string;
  ocrName: string;
  memberId: string | null;
  memberName: string | null;
  matchMethod: string | null;
  deleted: number;
};

async function loadParsedRowsForJob(input: {
  parseSessionId: string;
  rowIds: string[];
}): Promise<ParsedScoreboardRow[]> {
  if (input.rowIds.length === 0) return [];
  const db = getDb();
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
    );
  return rows.filter((row) => row.deleted !== 1);
}

async function persistParsedRowMatch(input: {
  rowId: string;
  memberId: string;
  memberName: string;
  matchMethod: string;
}): Promise<void> {
  const db = getDb();
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

async function createAshedMember(input: {
  connection: ParsedConnection;
  ashedAllianceId: string;
  currentName: string;
}): Promise<string> {
  const created = (await base44EntityPost(input.connection, "Member", {
    alliance_id: input.ashedAllianceId,
    current_name: input.currentName,
    status: "active",
    previous_names: [],
  })) as { id?: string };
  const id = created.id?.trim();
  if (!id) {
    throw new Error("Ashed did not return a member id.");
  }
  return id;
}

async function insertHqAllianceMember(input: {
  allianceId: string;
  ashedMemberId: string;
  ashedAllianceId: string;
  currentName: string;
  previousNames?: string[];
}): Promise<void> {
  const db = getDb();
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

  await syncCommanderFromAllianceMember({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.currentName,
  });
}

export async function createScoreboardMembersFromReview(input: {
  sessionId: string;
  allianceId: string;
  parseSessionId: string;
  rowIds: string[];
}): Promise<ScoreboardMemberActionResult> {
  const rows = await loadParsedRowsForJob({
    parseSessionId: input.parseSessionId,
    rowIds: input.rowIds,
  });
  const unmatched = rows.filter(
    (row) => !row.memberId && normalizeScoreboardMemberName(row.ocrName),
  );
  if (unmatched.length === 0) {
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

  const createdByName = new Map<string, string>();
  const members: ScoreboardMemberActionResult["members"] = [];
  const patchedRows: ScoreboardMemberActionResult["rows"] = [];

  for (const row of unmatched) {
    const name = row.ocrName.trim();
    const key = normalizeScoreboardMemberName(name);
    let ashedMemberId = createdByName.get(key);
    if (!ashedMemberId) {
      ashedMemberId =
        linkedAshedId && connection
          ? await createAshedMember({
              connection,
              ashedAllianceId: linkedAshedId,
              currentName: name,
            })
          : nanoid(16);
      await insertHqAllianceMember({
        allianceId: input.allianceId,
        ashedMemberId,
        ashedAllianceId,
        currentName: name,
      });
      createdByName.set(key, ashedMemberId);
      members.push({
        id: ashedMemberId,
        current_name: name,
        previous_names: [],
      });
    }

    await persistParsedRowMatch({
      rowId: row.id,
      memberId: ashedMemberId,
      memberName: name,
      matchMethod: "exact",
    });
    patchedRows.push({
      id: row.id,
      memberId: ashedMemberId,
      memberName: name,
      matchMethod: "exact",
      matchConfidence: 1,
    });
  }

  return { members, rows: patchedRows };
}

export async function applyScoreboardMemberNamesFromReview(input: {
  sessionId: string;
  allianceId: string;
  parseSessionId: string;
  rowIds: string[];
}): Promise<ScoreboardMemberActionResult> {
  const rows = await loadParsedRowsForJob({
    parseSessionId: input.parseSessionId,
    rowIds: input.rowIds,
  });
  const renameRows = rows.filter(
    (row) =>
      row.memberId &&
      row.matchMethod === SCOREBOARD_MANUAL_MATCH_METHOD &&
      normalizeScoreboardMemberName(row.ocrName),
  );
  if (renameRows.length === 0) {
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
    throw new Error("Connect Ashed before updating member names from a scoreboard.");
  }

  const db = getDb();
  const members: ScoreboardMemberActionResult["members"] = [];
  const patchedRows: ScoreboardMemberActionResult["rows"] = [];
  const renamedMemberIds = new Set<string>();

  for (const row of renameRows) {
    const memberId = row.memberId!;
    const nextName = row.ocrName.trim();
    if (renamedMemberIds.has(memberId)) {
      await persistParsedRowMatch({
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
      continue;
    }

    const [existing] = await db
      .select()
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          eq(schema.allianceMembers.ashedMemberId, memberId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error("Matched member not found.");
    }

    const previousNames = existing.previousNamesJson ?? [];
    const nextPrevious = nextPreviousNames(
      existing.currentName,
      previousNames,
      nextName,
    );
    if (nextPrevious === previousNames && existing.currentName === nextName) {
      continue;
    }

    await db
      .update(schema.allianceMembers)
      .set({
        currentName: nextName,
        previousNamesJson: nextPrevious,
        updatedAt: new Date(),
      })
      .where(eq(schema.allianceMembers.id, existing.id));

    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId: memberId,
      memberDisplayName: nextName,
    });

    if (linkedAshedId && connection) {
      await syncMemberNameToAshed(
        connection,
        memberId,
        nextName,
        nextPrevious,
      );
    }

    renamedMemberIds.add(memberId);
    members.push({
      id: memberId,
      current_name: nextName,
      previous_names: nextPrevious,
    });

    await persistParsedRowMatch({
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

  return { members, rows: patchedRows };
}
