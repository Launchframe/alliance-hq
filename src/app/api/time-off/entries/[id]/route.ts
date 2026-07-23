import { NextResponse } from "next/server";

import { serializeTimeOffEntry } from "@/lib/time-off/api.shared";
import {
  cancelTimeOffEntry,
  hqUserOwnsCommander,
} from "@/lib/time-off/repository.server";
import {
  requireTimeOffAllianceContext,
  requireTimeOffRead,
  requireTimeOffWrite,
} from "@/lib/time-off/route-helpers.server";
import { getDb, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const context = await requireTimeOffAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, session, allianceId } = context;
  const deniedRead = await requireTimeOffRead(sessionId);
  if (deniedRead) return deniedRead;

  const [existing] = await getDb()
    .select()
    .from(schema.memberTimeOff)
    .where(
      and(
        eq(schema.memberTimeOff.id, id),
        eq(schema.memberTimeOff.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const canManageOthers = !(await requireTimeOffWrite(sessionId));
  const ownsCommander =
    session.hqUserId != null &&
    (await hqUserOwnsCommander({
      allianceId,
      hqUserId: session.hqUserId,
      ashedMemberId: existing.ashedMemberId,
    }));

  if (!canManageOthers && !ownsCommander) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await cancelTimeOffEntry({ allianceId, entryId: id });
  if (!row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ entry: serializeTimeOffEntry(row) });
}
