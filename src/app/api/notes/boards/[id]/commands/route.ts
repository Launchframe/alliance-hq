import { NextResponse } from "next/server";
import { requireNoteBoardContext } from "@/lib/notes/board-access.server";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { boardCommandSchema, summarizeNoteBoard } from "@/lib/notes/board.shared";
import { executeNoteBoardCommand, noteBoardSnapshot } from "@/lib/notes/boards.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  try {
    const context = await requireNoteBoardContext(true);
    if (context instanceof NextResponse) return context;
    const command = boardCommandSchema.safeParse(await request.json().catch(() => null));
    if (!command.success) throw new KnowledgeAccessError("invalid");
    try {
      return NextResponse.json(await executeNoteBoardCommand(context.actor, id, command.data), { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (!(error instanceof KnowledgeAccessError) || error.code !== "changed") throw error;
      const response = await notesErrorResponse(error);
      const snapshot = await noteBoardSnapshot(context.actor, id);
      return NextResponse.json({ ...await response.json(), snapshot: new URL(request.url).searchParams.get("format") === "summary" ? summarizeNoteBoard(snapshot) : snapshot }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
  } catch (error) { return notesErrorResponse(error); }
}
