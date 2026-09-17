import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { getNoteTask } from "@/lib/notes/tasks.server";
import { loadResourceSharing, saveResourceSharing } from "@/lib/notes/sharing.server";
import { noteShareSchema } from "@/lib/notes/sharing.shared";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const task = await getNoteTask(context.actor, (await params).id, "share");
    if (!task) throw new KnowledgeAccessError("not_found");
    return NextResponse.json(await loadResourceSharing(context.actor, `task:${task.id}`), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const task = await getNoteTask(context.actor, (await params).id, "share");
    if (!task) throw new KnowledgeAccessError("not_found");
    const parsed = noteShareSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    return NextResponse.json(await saveResourceSharing(context.actor, `task:${task.id}`, parsed.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
