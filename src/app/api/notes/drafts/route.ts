import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { listCaptureDrafts } from "@/lib/notes/drafts.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const { items, ...page } = await listCaptureDrafts(context.actor, new URL(request.url).searchParams.get("cursor"));
    return NextResponse.json({ ...page, drafts: items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
