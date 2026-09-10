/**
 * POST /api/officer-intel/sessions/[id]/synthesize
 */

import { NextResponse } from "next/server";

import {
  getOfficerChatSessionForAlliance,
} from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelWrite,
} from "@/lib/officer-intel/route-helpers.server";
import { synthesizeOfficerMeetingNote } from "@/lib/officer-intel/synthesize.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Props = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;

  const chatSession = await getOfficerChatSessionForAlliance({
    sessionId: id,
    allianceId: context.allianceId,
  });
  if (!chatSession) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (chatSession.status !== "imported") {
    return NextResponse.json(
      { error: "Import chat messages before synthesizing notes." },
      { status: 400 },
    );
  }

  const result = await synthesizeOfficerMeetingNote({
    sessionId: id,
    allianceId: context.allianceId,
    hqUserId: context.session.hqUserId ?? null,
    sessionTitle: chatSession.title,
    channelLabel: chatSession.channelLabel,
  });

  if ("error" in result) {
    if (result.error === "not_configured") {
      return NextResponse.json(
        { error: "LLM synthesis is not configured." },
        { status: 503 },
      );
    }
    if (result.error === "no_messages") {
      return NextResponse.json(
        { error: "This session has no messages to synthesize." },
        { status: 400 },
      );
    }
    if (result.error === "approved") {
      return NextResponse.json(
        { error: "Approved meeting notes cannot be re-synthesized." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, noteId: result.noteId });
}
