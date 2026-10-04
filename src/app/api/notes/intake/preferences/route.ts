import { NextResponse } from "next/server";
import { z } from "zod";
import { requireNotesApiContext, notesErrorResponse } from "@/lib/notes/access.server";
import { loadIntakePreference, saveIntakePreference, setNoteIntakeConsent } from "@/lib/notes/intake.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

const preferenceSchema = z.object({ enabled: z.boolean(), expectedVersion: z.number().int().nonnegative(), noteId: z.string().min(1).max(120).optional() });
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    return NextResponse.json(await loadIntakePreference(context.actor), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    const { enabled, expectedVersion, noteId } = parsed.data;
    if (noteId) {
      await setNoteIntakeConsent(context.actor, noteId, enabled, expectedVersion);
      return NextResponse.json({ enabled }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(await saveIntakePreference(context.actor, enabled, expectedVersion), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
