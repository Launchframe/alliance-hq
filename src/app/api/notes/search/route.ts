import { NextResponse } from "next/server";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { noteSearchSchema } from "@/lib/notes/search.shared";
import { searchNotes } from "@/lib/notes/search.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = await requireNotesApiContext();
  if (context instanceof NextResponse) return context;
  const input = noteSearchSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return notesErrorResponse(new KnowledgeAccessError("invalid"));
  try { return NextResponse.json(await searchNotes(context.actor, input.data), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return notesErrorResponse(error); }
}
