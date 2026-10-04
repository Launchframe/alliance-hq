import { NextResponse } from "next/server";
import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { listNoteRevisions, listNoteRevisionPage, getNoteRevision } from "@/lib/performance-notes/repository.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const id = (await params).id, query = new URL(request.url).searchParams, headers = { "Cache-Control": "private, no-store" };
    if (query.has("version")) return NextResponse.json({ revision: await getNoteRevision(context.actor, id, Number(query.get("version"))) }, { headers });
    if (query.has("format")) {
      if (query.get("format") !== "summary") throw new KnowledgeAccessError("invalid");
      return NextResponse.json(await listNoteRevisionPage(context.actor, id, query.get("cursor")), { headers });
    }
    const revisions = await listNoteRevisions(context.actor, id);
    return NextResponse.json({ revisions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
