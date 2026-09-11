import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { notesErrorResponse, requireNotesApiContext } from "@/lib/notes/access.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { attachMembersToPerformanceNote, getPerformanceNoteDto, listPerformanceNoteRoster } from "@/lib/performance-notes/repository.server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const access = await requireNotesApiContext();
    if (access instanceof NextResponse) return access;
    const { id } = await context.params;
    const note = await getPerformanceNoteDto({ noteId: id, actor: access.actor });
    if (!note) throw new KnowledgeAccessError("not_found");
    const roster = await listPerformanceNoteRoster(access.actor.allianceId);
    return NextResponse.json({ note, roster }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}

export async function PATCH(request: Request, context: Ctx) {
  try {
    const access = await requireNotesApiContext();
    if (access instanceof NextResponse) return access;
    const { id } = await context.params;
    const existing = await getPerformanceNoteDto({ noteId: id, actor: access.actor });
    if (!existing?.canEdit) throw new KnowledgeAccessError("not_found");
    const input: unknown = await request.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input) || !("memberIds" in input) || !Array.isArray(input.memberIds) || !input.memberIds.every((value) => typeof value === "string")) {
      const t = await getTranslations("notes");
      return NextResponse.json({ error: t("errors.invalid"), code: "invalid" }, { status: 400 });
    }
    const selected = new Set(input.memberIds as string[]);
    const roster = await listPerformanceNoteRoster(access.actor.allianceId);
    await attachMembersToPerformanceNote({
      actor: access.actor, noteId: id,
      members: roster.filter((member) => selected.has(member.ashedMemberId)).map((member) => ({ ashedMemberId: member.ashedMemberId, memberNameRaw: member.name })),
    });
    const note = await getPerformanceNoteDto({ noteId: id, actor: access.actor });
    if (!note) throw new KnowledgeAccessError("not_found");
    return NextResponse.json({ note, roster }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return notesErrorResponse(error); }
}
