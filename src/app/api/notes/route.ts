import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { countCaptureDrafts } from "@/lib/notes/drafts.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { noteFieldsSchema, parseNoteListCursor, readNoteListFilter } from "@/lib/notes/workspace.shared";
import { createPerformanceNote, getPerformanceNoteDto, listPerformanceNotePage, listPerformanceNoteRoster, listPerformanceNotes } from "@/lib/performance-notes/repository.server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const params = new URL(request.url).searchParams;
    if (params.get("format") === "summary") {
      const [page, drafts] = await Promise.all([listPerformanceNotePage(context.actor, readNoteListFilter(params), parseNoteListCursor(params.get("cursor"))), countCaptureDrafts(context.actor)]);
      return NextResponse.json({ ...page, canCreate: context.actor.canCreate, canReadBoards: context.actor.canReadBoards, draftCount: drafts }, { headers });
    }
    if (params.has("format")) throw new KnowledgeAccessError("invalid");
    const [notes, roster, drafts] = await Promise.all([listPerformanceNotes(context.actor), listPerformanceNoteRoster(context.actor.allianceId), countCaptureDrafts(context.actor)]);
    return NextResponse.json({ notes, roster, canCreate: context.actor.canCreate, canReadBoards: context.actor.canReadBoards, draftCount: drafts }, { headers });
  } catch (error) { return notesErrorResponse(error instanceof ZodError || error instanceof SyntaxError ? new KnowledgeAccessError("invalid") : error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireNotesApiContext("notes:create");
    if (context instanceof NextResponse) return context;
    const parsed = noteFieldsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    const fields = parsed.data;
    const noteId = await createPerformanceNote({ ...fields, actor: context.actor, intakeMode: fields.kind === "note" ? "thought" : "batch" });
    if (new URL(request.url).searchParams.get("format") === "summary") return NextResponse.json({ noteId, note: await getPerformanceNoteDto({ actor: context.actor, noteId }) }, { headers });
    const [notes, roster, drafts] = await Promise.all([listPerformanceNotes(context.actor), listPerformanceNoteRoster(context.actor.allianceId), countCaptureDrafts(context.actor)]);
    return NextResponse.json({ notes, roster, noteId, canCreate: context.actor.canCreate, canReadBoards: context.actor.canReadBoards, draftCount: drafts }, { headers });
  } catch (error) { return notesErrorResponse(error); }
}
