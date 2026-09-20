import { NextResponse } from "next/server";
import { requireNoteBoardContext } from "@/lib/notes/board-access.server";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { noteBoardSnapshot } from "@/lib/notes/boards.server";
import { summarizeNoteBoard } from "@/lib/notes/board.shared";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireNoteBoardContext();
    if (context instanceof NextResponse) return context;
    const format = new URL(request.url).searchParams.get("format");
    if (format && format !== "summary") throw new KnowledgeAccessError("invalid");
    const snapshot = await noteBoardSnapshot(context.actor, (await params).id);
    return NextResponse.json(format === "summary" ? summarizeNoteBoard(snapshot) : snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
