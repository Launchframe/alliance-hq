import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { getNoteTask, updateNoteTask } from "@/lib/notes/tasks.server";
import { taskPatchSchema } from "@/lib/notes/tasks.shared";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const task = await getNoteTask(context.actor, (await params).id);
    if (!task) throw new KnowledgeAccessError("not_found");
    return NextResponse.json({ task }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const parsed = taskPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    const task = await updateNoteTask(context.actor, (await params).id, parsed.data);
    return NextResponse.json({ task }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
