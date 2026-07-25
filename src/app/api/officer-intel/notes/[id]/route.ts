/**
 * GET /api/officer-intel/notes/[id]
 * PUT /api/officer-intel/notes/[id]
 */

import { NextResponse } from "next/server";

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
  });
  if (!note) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const actionItems = await listOfficerActionItemsForNote({
    noteId: id,
    allianceId: context.allianceId,
  });

  return NextResponse.json({ note, actionItems });
}

export async function PUT(request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;

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

  const summary = typeof body.summary === "string" ? body.summary : undefined;
  const keyDecisions = Array.isArray(body.keyDecisions)
    ? body.keyDecisions.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const openQuestions = Array.isArray(body.openQuestions)
    ? body.openQuestions.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const approve = body.approve === true;

  const result = await updateOfficerMeetingNote({
    noteId: id,
    allianceId: context.allianceId,
    hqUserId: context.session.hqUserId ?? null,
    summary,
    keyDecisions,
    openQuestions,
    approve,
  });

  if ("error" in result) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }

  const note = await getOfficerMeetingNoteForAlliance({
    noteId: id,
    allianceId: context.allianceId,
  });
  const actionItems = await listOfficerActionItemsForNote({
    noteId: id,
    allianceId: context.allianceId,
  });

  return NextResponse.json({ ok: true, note, actionItems });
}
