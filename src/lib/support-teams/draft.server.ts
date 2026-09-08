import "server-only";

import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { SupportAccess } from "./access.server";
import { applyDraftCommand, draftSnapshot, type DraftCommand } from "./draft.shared";
import { withDraftStintTokens } from "./draft-roster.server";
import { loadBoard } from "./repository.server";
import { loadSupportRoster } from "./roster.server";
import { mutate } from "./service.server";
import { SupportError } from "./types.shared";

export async function executeDraftCommand(access: SupportAccess, command: DraftCommand, idempotencyKey: string) {
  return mutate(access, command, idempotencyKey, (board, _history, roster, actor, identity) => applyDraftCommand(board, roster, actor, command, identity));
}
export async function loadDraftSnapshot(access: SupportAccess, id: string) {
  if (!access.actor.canRead) throw new SupportError("forbidden");
  return getDb().transaction(async (db) => {
    const board = await loadBoard(db, access.actor.allianceId);
    const roster = await withDraftStintTokens(db, access.actor.allianceId, await loadSupportRoster(access.actor.allianceId, db));
    const clock = await db.execute(sql`select clock_timestamp() as now`);
    return draftSnapshot(board, roster, access.actor, id, new Date(clock[0].now as string | Date).getTime());
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
