import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { captureCommitSchema } from "@/lib/notes/intake.shared";
import { commitNoteCapture } from "@/lib/notes/tasks.server";
import { commitCaptureDraft } from "@/lib/notes/drafts.server";
import { getPerformanceNoteDto } from "@/lib/performance-notes/repository.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const input = captureCommitSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    if (!input.data.draftId && !context.actor.canCreate) throw new KnowledgeAccessError("forbidden");
    if (input.data.draftId && !input.data.expectedDraftVersion) throw new KnowledgeAccessError("invalid");
    const result = input.data.draftId ? await commitCaptureDraft(context.actor, input.data.draftId, input.data.expectedDraftVersion!, input.data.requestId) : await commitNoteCapture(context.actor, input.data);
    const note = await getPerformanceNoteDto({ actor: context.actor, noteId: result.noteId! });
    if (!note) throw new KnowledgeAccessError("not_found");
    return NextResponse.json({ ...result, note }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
