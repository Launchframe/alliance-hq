import { NextResponse } from "next/server";
import { requireNoteBoardContext } from "@/lib/notes/board-access.server";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { noteBoardSnapshot } from "@/lib/notes/boards.server";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireNoteBoardContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json(await noteBoardSnapshot(context.actor, (await params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
