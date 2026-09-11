import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { attachMembersToPerformanceNote, createPerformanceNote, listPerformanceNoteRoster, listPerformanceNotes } from "@/lib/performance-notes/repository.server";
import { PERFORMANCE_NOTE_KINDS, type PerformanceNoteKind } from "@/lib/performance-notes/types.shared";

export const dynamic = "force-dynamic";

function isKind(value: unknown): value is PerformanceNoteKind {
  return typeof value === "string" && (PERFORMANCE_NOTE_KINDS as readonly string[]).includes(value);
}

export async function GET() {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const [notes, roster] = await Promise.all([
      listPerformanceNotes(context.actor),
      listPerformanceNoteRoster(context.actor.allianceId),
    ]);
    return NextResponse.json({ notes, roster }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireNotesApiContext();
    if (context instanceof NextResponse) return context;
    const t = await getTranslations("notes");
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: t("errors.invalid"), code: "invalid" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const text = typeof input.body === "string" ? input.body.trim() : "";
    if (!text || text.length > 100_000 || (input.kind !== undefined && !isKind(input.kind))) {
      return NextResponse.json({ error: t("errors.invalid"), code: "invalid" }, { status: 400 });
    }
    const kind = isKind(input.kind) ? input.kind : "note";
    const noteId = await createPerformanceNote({ actor: context.actor, kind, intakeMode: kind === "note" ? "thought" : "batch", body: text });
    const roster = await listPerformanceNoteRoster(context.actor.allianceId);
    if (Array.isArray(input.memberIds) && input.memberIds.length) {
      const selected = new Set(input.memberIds.filter((id): id is string => typeof id === "string"));
      await attachMembersToPerformanceNote({
        actor: context.actor, noteId,
        members: roster.filter((member) => selected.has(member.ashedMemberId)).map((member) => ({ ashedMemberId: member.ashedMemberId, memberNameRaw: member.name })),
      });
    }
    const notes = await listPerformanceNotes(context.actor);
    return NextResponse.json({ notes, roster, noteId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
