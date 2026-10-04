import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { intakeRequestSchema } from "@/lib/notes/intake.shared";
import { interpretNoteCapture } from "@/lib/notes/intake.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const parsed = intakeRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    if (!parsed.data.noteId && !context.actor.canCreate) throw new KnowledgeAccessError("forbidden");
    const result = await interpretNoteCapture(context.actor, parsed.data, request.signal);
    return NextResponse.json(result, { status: result.state === "pending" ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
