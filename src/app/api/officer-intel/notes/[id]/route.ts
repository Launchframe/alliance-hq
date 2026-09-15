/**
 * GET /api/officer-intel/notes/[id]
 * PUT /api/officer-intel/notes/[id]
 */

import { NextResponse } from "next/server";
import { notesErrorResponse } from "@/lib/notes/access.server";
import { notePatchSchema } from "@/lib/notes/workspace.shared";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

import {
  getOfficerMeetingNoteForAlliance,
  listOfficerActionItemsForNote,
  updateOfficerMeetingNote,
} from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
  requireOfficerIntelWrite,
} from "@/lib/officer-intel/route-helpers.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;

  const note = await getOfficerMeetingNoteForAlliance({
    noteId: id,
    allianceId: context.allianceId,
    actor: context.actor,
  });
  if (!note) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const actionItems = await listOfficerActionItemsForNote({
    noteId: id,
    allianceId: context.allianceId,
    actor: context.actor,
  });

  return NextResponse.json({ note, actionItems });
}

export async function PUT(request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;
  const current = await getOfficerMeetingNoteForAlliance({ noteId: id, allianceId: context.allianceId, actor: context.actor });
  if (!current?.canEdit) return notesErrorResponse(new KnowledgeAccessError("not_found"));

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = notePatchSchema.safeParse({ expectedVersion: body.expectedVersion, body: body.summary, keyDecisions: body.keyDecisions, openQuestions: body.openQuestions });
  if (!parsed.success || body.approve !== undefined && typeof body.approve !== "boolean") return notesErrorResponse(new KnowledgeAccessError("invalid"));
  const { body: summary, keyDecisions, openQuestions, expectedVersion } = parsed.data;
  const approve = body.approve === true;

  const result = await updateOfficerMeetingNote({
    actor: context.actor,
    noteId: id,
    allianceId: context.allianceId,
    hqUserId: context.session.hqUserId ?? null,
    expectedVersion,
    summary,
    keyDecisions,
    openQuestions,
    approve,
  }).catch(notesErrorResponse);
  if (result instanceof NextResponse) return result;

  if ("error" in result) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const note = await getOfficerMeetingNoteForAlliance({
    noteId: id,
    allianceId: context.allianceId,
    actor: context.actor,
  });
  const actionItems = await listOfficerActionItemsForNote({
    noteId: id,
    allianceId: context.allianceId,
    actor: context.actor,
  });

  return NextResponse.json({ ok: true, note, actionItems });
}
