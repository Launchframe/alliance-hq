import { NextResponse } from "next/server";
import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { historyMediaTarget } from "@/lib/notes/imports.server";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string; mediaId: string }> };

export async function GET(request: Request, { params }: Props) {
  const { id, mediaId } = await params;
  const context = await requireNotesApiContext("notes:read");
  if (context instanceof NextResponse) return context;
  try {
    const target = await historyMediaTarget(context.actor, id, mediaId, new URL(request.url).searchParams.get("variant") === "thumbnail");
    const buffer = await getObject(target.storageKey);
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": target.contentType, "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
