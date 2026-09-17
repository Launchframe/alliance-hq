import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { discardCaptureDraft, getCaptureDraft, saveCaptureDraft } from "@/lib/notes/drafts.server";
import { draftSaveSchema } from "@/lib/notes/drafts.shared";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json(await getCaptureDraft(context.actor, (await params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    await discardCaptureDraft(context.actor, (await params).id);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const parsed = draftSaveSchema.safeParse(await request.json().catch(() => null));
    const { id } = await params;
    if (!parsed.success || !/^[a-zA-Z0-9_-]{8,120}$/.test(id)) throw new KnowledgeAccessError("invalid");
    return NextResponse.json(await saveCaptureDraft(context.actor, id, parsed.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
