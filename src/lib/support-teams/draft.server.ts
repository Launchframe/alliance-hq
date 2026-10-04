import "server-only";

import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { SupportAccess } from "./access.server";
import { applyDraftCommand, draftSnapshot, type DraftCommand } from "./draft.shared";
import { withDraftStintTokens } from "./draft-roster.server";
import { loadBoard } from "./repository.server";
import { loadSupportRoster, loadSupportStints } from "./roster.server";
import { bindStintAssignments, projectMemberships } from "./maintenance.server";
import { mutate } from "./service.server";
import { SupportError } from "./types.shared";

export async function executeDraftCommand(access: SupportAccess, command: DraftCommand, idempotencyKey: string) {
  return mutate(access, command, idempotencyKey, (board, _history, roster, actor, identity, originalVersion) => {
    if (command.kind !== "draftPick" && (command.expectedVersion !== originalVersion || (originalVersion !== 0 && board.version !== originalVersion))) throw new SupportError("changed");
    const current = command.kind === "draftPick" ? command : { ...command, expectedVersion: board.version };
    return bindStintAssignments(board, actor, applyDraftCommand(board, roster, actor, current, identity));
  });
}
export async function loadDraftSnapshot(access: SupportAccess, id: string) {
  if (!access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => {
    const stored = await loadBoard(db, access.actor.allianceId);
    const roster = await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db));
    const board = projectMemberships(stored, roster, await loadSupportStints(access.actor.allianceId, db));
    const clock = await db.execute(sql`select clock_timestamp() as now`);
    const snapshot = draftSnapshot(board, roster, access.actor, id, new Date(clock[0].now as string | Date).getTime());
    return { ...snapshot, roster: roster.map((member) => { const visible = { ...member }; delete visible.draftStintToken; return visible; }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
