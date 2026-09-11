import { NextResponse } from "next/server";

import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { noteFieldsSchema } from "@/lib/notes/workspace.shared";
import { createPerformanceNote, listPerformanceNoteRoster, listPerformanceNotes } from "@/lib/performance-notes/repository.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const [notes, roster] = await Promise.all([listPerformanceNotes(context.actor), listPerformanceNoteRoster(context.actor.allianceId)]);
    return NextResponse.json({ notes, roster, canCreate: context.actor.canCreate }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireNotesApiContext("notes:create");
    if (context instanceof NextResponse) return context;
    const parsed = noteFieldsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    const fields = parsed.data;
    const noteId = await createPerformanceNote({ ...fields, actor: context.actor, intakeMode: fields.kind === "note" ? "thought" : "batch" });
    const [notes, roster] = await Promise.all([listPerformanceNotes(context.actor), listPerformanceNoteRoster(context.actor.allianceId)]);
    return NextResponse.json({ notes, roster, noteId, canCreate: context.actor.canCreate }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
