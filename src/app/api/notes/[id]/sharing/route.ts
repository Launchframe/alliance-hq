import { NextResponse } from "next/server";
import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { loadNoteSharing, saveNoteSharing } from "@/lib/notes/sharing.server";
import { noteShareSchema } from "@/lib/notes/sharing.shared";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json(await loadNoteSharing(context.actor, (await params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const input = noteShareSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    return NextResponse.json(await saveNoteSharing(context.actor, (await params).id, input.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
