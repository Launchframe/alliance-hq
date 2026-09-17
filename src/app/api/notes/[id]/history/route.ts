import { NextResponse } from "next/server";
import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { listNoteRevisions } from "@/lib/performance-notes/repository.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const revisions = await listNoteRevisions(context.actor, (await params).id);
    return NextResponse.json({ revisions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
