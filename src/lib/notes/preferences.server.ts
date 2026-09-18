import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { KnowledgeWebActor } from "./access.server";
import { KnowledgeAccessError, recheckKnowledgeActor } from "./resources.server";
import { noteWorkspaceStateSchema, workspacePreferenceWriteSchema, readWorkspaceState, noteFilterFromWorkspace, parseNoteListCursor, type WorkspacePreferences } from "./workspace.shared";

const preferences = schema.knowledgeWorkspacePreferences;
export async function readWorkspacePreferences(actor: KnowledgeWebActor): Promise<WorkspacePreferences> {
  if (!actor.hqUserId) throw new KnowledgeAccessError("forbidden");
  const [row] = await getDb().select().from(preferences).where(and(eq(preferences.hqUserId, actor.hqUserId), eq(preferences.allianceId, actor.allianceId)));
  const state = noteWorkspaceStateSchema.parse(row?.state ?? {});
  if (!actor.canReadBoards && state.view === "boards") state.view = "notebook";
  return { scope: `${actor.allianceId}:${actor.hqUserId}`, version: row?.version ?? 0, state };
}
export async function loadWorkspaceQuery(actor: KnowledgeWebActor, params: URLSearchParams) {
  const preferences = await readWorkspacePreferences(actor);
  const state = readWorkspaceState(params, preferences.state, preferences.scope);
  const foreign = params.has("workspaceScope") && params.get("workspaceScope") !== preferences.scope;
  let cursor = null;
  try { cursor = foreign ? null : parseNoteListCursor(params.get("cursor")); } catch { cursor = null; }
  if (cursor?.scope !== preferences.scope) cursor = null;
  return { preferences, filter: noteFilterFromWorkspace(state), cursor };
}
export async function saveWorkspacePreferences(actor: KnowledgeWebActor, raw: unknown): Promise<WorkspacePreferences> {
  const parsed = workspacePreferenceWriteSchema.safeParse(raw);
  if (!parsed.success) throw new KnowledgeAccessError("invalid");
  const input = parsed.data;
  const scope = `${actor.allianceId}:${actor.hqUserId}`;
  if (!actor.hqUserId || input.expectedScope !== scope) throw new KnowledgeAccessError("forbidden");
  return getDb().transaction(async (tx) => {
    await recheckKnowledgeActor(tx, actor);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`notes-preferences:${scope}`}, 0))`);
    const where = and(eq(preferences.hqUserId, actor.hqUserId!), eq(preferences.allianceId, actor.allianceId));
    const [row] = await tx.select().from(preferences).where(where).for("update");
    if ((row?.version ?? 0) !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    const result = { scope, version: input.expectedVersion + 1, state: input.state };
    await tx.insert(preferences).values({ hqUserId: actor.hqUserId!, allianceId: actor.allianceId, state: result.state, version: result.version })
      .onConflictDoUpdate({ target: [preferences.hqUserId, preferences.allianceId], set: { state: result.state, version: result.version, updatedAt: new Date() } });
    return result;
  });
}
