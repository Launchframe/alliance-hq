import { NextResponse } from "next/server";

import {
  attachMembersToPerformanceNote,
  getPerformanceNoteDto,
  listPerformanceNoteRoster,
} from "@/lib/performance-notes/repository.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { id } = await context.params;
  const [note, roster] = await Promise.all([
    getPerformanceNoteDto({ noteId: id, allianceId }),
    listPerformanceNoteRoster(allianceId),
  ]);
  if (!note) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ note, roster });
}

export async function PATCH(request: Request, context: Ctx) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { id } = await context.params;
  const existing = await getPerformanceNoteDto({ noteId: id, allianceId });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body: { memberIds?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    body = parsed as { memberIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const memberIds = Array.isArray(body.memberIds)
    ? body.memberIds.filter((value): value is string => typeof value === "string")
    : [];
  const roster = await listPerformanceNoteRoster(allianceId);
  const nameById = new Map(roster.map((row) => [row.ashedMemberId, row.name]));
  await attachMembersToPerformanceNote({
    allianceId,
    noteId: id,
    members: memberIds
      .map((ashedMemberId) => {
        const name = nameById.get(ashedMemberId);
        if (!name) return null;
        return { ashedMemberId, memberNameRaw: name };
      })
      .filter((row): row is { ashedMemberId: string; memberNameRaw: string } => row != null),
  });

  const note = await getPerformanceNoteDto({ noteId: id, allianceId });
  return NextResponse.json({ note, roster });
}
