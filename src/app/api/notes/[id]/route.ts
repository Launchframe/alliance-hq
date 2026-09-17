import { NextResponse } from "next/server";

import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { notePatchSchema } from "@/lib/notes/workspace.shared";
import { getPerformanceNoteDto, listPerformanceNoteRoster, updatePerformanceNote } from "@/lib/performance-notes/repository.server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const access = await requireNotesApiContext();
    if (access instanceof NextResponse) return access;
    const { id } = await context.params;
    const note = await getPerformanceNoteDto({ noteId: id, actor: access.actor });
    if (!note) throw new KnowledgeAccessError("not_found");
    const roster = await listPerformanceNoteRoster(access.actor.allianceId);
    return NextResponse.json({ note, roster }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}

export async function PATCH(request: Request, context: Ctx) {
  try {
    const access = await requireNotesApiContext();
    if (access instanceof NextResponse) return access;
    const { id } = await context.params;
    const existing = await getPerformanceNoteDto({ noteId: id, actor: access.actor });
    if (!existing?.canEdit) throw new KnowledgeAccessError("not_found");
    const input: unknown = await request.json().catch(() => null);
    const parsed = notePatchSchema.safeParse(input);
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    await updatePerformanceNote(access.actor, id, parsed.data);
    const note = await getPerformanceNoteDto({ noteId: id, actor: access.actor });
    if (!note) throw new KnowledgeAccessError("not_found");
    return NextResponse.json({ note }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
