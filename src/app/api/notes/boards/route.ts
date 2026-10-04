import { NextResponse } from "next/server";
import { requireNoteBoardContext } from "@/lib/notes/board-access.server";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { boardCreateSchema } from "@/lib/notes/board.shared";
import { createNoteBoard, listNoteBoards } from "@/lib/notes/boards.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const context = await requireNoteBoardContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json({ boards: await listNoteBoards(context.actor), canWrite: context.actor.canWriteBoards, allianceId: context.actor.allianceId, principalId: context.actor.hqUserId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const context = await requireNoteBoardContext(true);
    if (context instanceof NextResponse) return context;
    const parsed = boardCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    return NextResponse.json(await createNoteBoard(context.actor, parsed.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
