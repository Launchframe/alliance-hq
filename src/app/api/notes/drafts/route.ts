import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { listCaptureDrafts } from "@/lib/notes/drafts.server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json({ drafts: await listCaptureDrafts(context.actor) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
