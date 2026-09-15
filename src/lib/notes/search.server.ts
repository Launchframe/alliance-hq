import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { escapeLikePrefix } from "@/lib/admin/audit-query";
import type { KnowledgeWebActor } from "./access.server";
import { knowledgeAccessCondition } from "./resources.server";
import { redactIntakeText } from "./intake.shared";
import { noteSearchSchema, type NoteSearchInput, type NoteSearchResponse } from "./search.shared";

export async function searchNotes(actor: KnowledgeWebActor, raw: NoteSearchInput): Promise<NoteSearchResponse> {
  const input = noteSearchSchema.parse(raw);
  const query = redactIntakeText(input.q);
  const terms = sql`plainto_tsquery('simple', notes_search_text(${query}))`;
  const matches = (body: SQL) => sql`(notes_search_vector(${body}) @@ ${terms} or (octet_length(${body}) > 300000 and notes_search_text(${body}) ilike ${`%${escapeLikePrefix(query)}%`} escape '\\'))`;
  const rank = (body: SQL) => sql`ts_rank_cd(notes_search_vector(${body}), ${terms})`;
  const noteBody = sql`notes_document_text(n.title, n.body, n.key_decisions, n.open_questions)`;
  const taskBody = sql`a.title || E'\n' || coalesce(a.description, '')`;
  const rows = await getDb().execute(sql`
    select * from (
      select 'note' as kind, n.id, n.title, left(notes_search_text(${noteBody}), 1000) as excerpt, null::text as source_id, null::timestamptz as source_date, n.updated_at, ${rank(noteBody)} as rank
      from performance_notes n join knowledge_resources r on r.id = n.resource_id and r.alliance_id = n.alliance_id
      where ${input.kind === "all" || input.kind === "note"} and n.alliance_id = ${actor.allianceId} and n.expunged_at is null and r.archived_at is null
        and ${knowledgeAccessCondition(actor, sql`n.resource_id`)} and ${matches(noteBody)}
      union all
      select 'task', a.id, a.title, left(notes_search_text(${taskBody}), 1000), null::text, null::timestamptz, a.updated_at, ${rank(taskBody)}
      from officer_action_items a join knowledge_resources r on r.id = a.resource_id and r.alliance_id = a.alliance_id
      where ${input.kind === "all" || input.kind === "task"} and a.alliance_id = ${actor.allianceId} and r.archived_at is null
        and ${knowledgeAccessCondition(actor, sql`a.resource_id`)} and ${matches(taskBody)}
      union all
      select 'source', m.id, s.title, left(notes_search_text(m.original_text), 1000), s.id, coalesce(m.sent_at, s.session_at), s.updated_at, ${rank(sql`m.original_text`)}
      from officer_chat_messages m join officer_chat_sessions s on s.id = m.session_id and s.alliance_id = m.alliance_id
        join knowledge_resources r on r.id = s.resource_id and r.alliance_id = s.alliance_id
      where ${input.kind === "all" || input.kind === "source"} and s.alliance_id = ${actor.allianceId} and s.status = 'imported' and m.history_included and r.archived_at is null
        and not exists(select 1 from knowledge_history_imports h where h.id = s.id and h.state <> 'committed')
        and ${knowledgeAccessCondition(actor, sql`s.resource_id`)} and ${matches(sql`m.original_text`)}
    ) results order by rank desc, updated_at desc, kind, id limit ${input.limit + 1} offset ${input.offset}
  `);
  return { nextOffset: rows.length > input.limit && input.offset + input.limit <= 5_000 ? input.offset + input.limit : null, results: rows.slice(0, input.limit).map((row) => {
    const kind = row.kind as "note" | "task" | "source";
    return { id: String(row.id), kind, title: redactIntakeText(String(row.title)), excerpt: redactIntakeText(String(row.excerpt)),
      href: kind === "note" ? `/notes/${row.id}` : kind === "task" ? `/notes?view=tasks&task=${encodeURIComponent(String(row.id))}` : actor.isOfficer ? `/officer-intel/sessions/${row.source_id}` : null,
      sourceDate: row.source_date instanceof Date ? row.source_date.toISOString() : row.source_date ? new Date(String(row.source_date)).toISOString() : null,
    };
  }) };
}
