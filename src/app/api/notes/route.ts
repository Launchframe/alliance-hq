import { NextResponse } from "next/server";

import {
  attachMembersToPerformanceNote,
  createPerformanceNote,
  listPerformanceNoteRoster,
  listPerformanceNotes,
} from "@/lib/performance-notes/repository.server";
import {
  PERFORMANCE_NOTE_KINDS,
  type PerformanceNoteKind,
} from "@/lib/performance-notes/types.shared";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function isKind(value: unknown): value is PerformanceNoteKind {
  return (
    typeof value === "string" &&
    (PERFORMANCE_NOTE_KINDS as readonly string[]).includes(value)
  );
}

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const [notes, roster] = await Promise.all([
    listPerformanceNotes(allianceId),
    listPerformanceNoteRoster(allianceId),
  ]);
  return NextResponse.json({ notes, roster });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  let body: { body?: unknown; kind?: unknown; memberIds?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    body = parsed as { body?: unknown; kind?: unknown; memberIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Note body is required." }, { status: 400 });
  }
  const kind = isKind(body.kind) ? body.kind : "note";
  const memberIds = Array.isArray(body.memberIds)
    ? body.memberIds.filter((id): id is string => typeof id === "string")
    : [];

  const noteId = await createPerformanceNote({
    allianceId,
    kind,
    intakeMode: kind === "note" ? "thought" : "batch",
    body: text,
    source: "web",
    createdByHqUserId: session.hqUserId,
  });

  if (memberIds.length > 0) {
    const roster = await listPerformanceNoteRoster(allianceId);
    const nameById = new Map(roster.map((row) => [row.ashedMemberId, row.name]));
    await attachMembersToPerformanceNote({
      allianceId,
      noteId,
      members: memberIds
        .map((ashedMemberId) => {
          const name = nameById.get(ashedMemberId);
          if (!name) return null;
          return { ashedMemberId, memberNameRaw: name };
        })
        .filter((row): row is { ashedMemberId: string; memberNameRaw: string } => row != null),
    });
  }

  const [notes, roster] = await Promise.all([
    listPerformanceNotes(allianceId),
    listPerformanceNoteRoster(allianceId),
  ]);
  return NextResponse.json({ notes, roster, noteId });
}
