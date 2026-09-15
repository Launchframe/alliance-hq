import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { KnowledgeTransaction } from "./resources.server";

export async function lockTaskBoards(tx: KnowledgeTransaction, taskId: string, additional: string[] = []) {
  const placements = await tx.select({ id: schema.knowledgeBoardItems.boardId }).from(schema.knowledgeBoardItems).where(eq(schema.knowledgeBoardItems.taskId, taskId));
  const ids = [...new Set([...placements.map((row) => row.id), ...additional])].sort();
  if (ids.length) await tx.select({ id: schema.knowledgeBoards.id }).from(schema.knowledgeBoards).where(inArray(schema.knowledgeBoards.id, ids)).orderBy(asc(schema.knowledgeBoards.id)).for("update");
  return ids;
}
export async function advanceNoteBoard(tx: KnowledgeTransaction, boardId: string) {
  const [board] = await tx.update(schema.knowledgeBoards).set({ version: sql`${schema.knowledgeBoards.version} + 1`, updatedAt: new Date() }).where(eq(schema.knowledgeBoards.id, boardId)).returning();
  await tx.execute(sql`select pg_notify('knowledge_board_changes', ${JSON.stringify({ allianceId: board.allianceId, boardId: board.id, version: board.version })})`);
  return board.version;
}
export async function touchTaskBoards(tx: KnowledgeTransaction, taskId: string, excludeBoardId?: string) {
  for (const id of await lockTaskBoards(tx, taskId)) if (id !== excludeBoardId) await advanceNoteBoard(tx, id);
}
export async function touchResourceBoards(tx: KnowledgeTransaction, resourceId: string) {
  const [task] = await tx.select({ id: schema.officerActionItems.id }).from(schema.officerActionItems).where(and(eq(schema.officerActionItems.resourceId, resourceId)));
  if (task) await touchTaskBoards(tx, task.id);
}
