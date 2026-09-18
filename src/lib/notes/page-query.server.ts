import "server-only";

import { listPerformanceNotePage } from "@/lib/performance-notes/repository.server";
import type { KnowledgeActor } from "./policy.shared";
import { KnowledgeAccessError } from "./resources.server";
import { noteListFilterSchema, parseNoteListCursor, readNoteListFilter, type NoteListCursor, type NoteListFilter } from "./workspace.shared";

export async function loadNotePageQuery(actor: KnowledgeActor, query: URLSearchParams) {
  let filter: NoteListFilter, cursor: NoteListCursor | null;
  try { filter = readNoteListFilter(query); } catch { filter = noteListFilterSchema.parse({}); }
  try { cursor = parseNoteListCursor(query.get("cursor")); } catch { cursor = null; }
  const page = await listPerformanceNotePage(actor, filter, cursor).catch((error) => {
    if (!cursor || !(error instanceof KnowledgeAccessError) || !["invalid", "forbidden"].includes(error.code)) throw error;
    cursor = null;
    return listPerformanceNotePage(actor, filter, null);
  });
  return { page, cursor: cursor ? JSON.stringify(cursor) : null };
}
