import { NextResponse } from "next/server";
import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { historyAssetTarget } from "@/lib/notes/imports.server";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string; assetId: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { id, assetId } = await params;
  const context = await requireNotesApiContext("notes:read");
  if (context instanceof NextResponse) return context;
  try {
    const target = await historyAssetTarget(context.actor, id, assetId);
    const buffer = await getObject(target.storageKey);
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": target.contentType, "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
