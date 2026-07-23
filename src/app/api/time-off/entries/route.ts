import { NextResponse } from "next/server";

import {
  serializeTimeOffEntry,
  validateTimeOffEntryPayload,
  type TimeOffEntryPayload,
} from "@/lib/time-off/api.shared";
import { parseTimeOffMessage } from "@/lib/time-off/parse-natural-language.shared";
import {
  createTimeOffEntry,
  hqUserOwnsCommander,
  listLinkedCommanderIdsForHqUser,
} from "@/lib/time-off/repository.server";
import {
  requireTimeOffAllianceContext,
  requireTimeOffRead,
  requireTimeOffWrite,
} from "@/lib/time-off/route-helpers.server";
import { loadAllianceMembers } from "@/lib/members/load";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

type CreateBody = TimeOffEntryPayload & {
  naturalLanguage?: string;
};

export async function POST(request: Request) {
  const context = await requireTimeOffAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, session, allianceId } = context;
  const deniedRead = await requireTimeOffRead(sessionId);
  if (deniedRead) return deniedRead;

  const body = (await request.json()) as CreateBody;
  let payload: TimeOffEntryPayload = { ...body };

  if (body.naturalLanguage?.trim()) {
    const parsed = parseTimeOffMessage(
      body.naturalLanguage.trim(),
      getServerCalendarDate(),
    );
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "Could not understand that time-off message." },
        { status: 400 },
      );
    }
    const linkedIds = session.hqUserId
      ? await listLinkedCommanderIdsForHqUser({
          allianceId,
          hqUserId: session.hqUserId,
        })
      : [];
    if (linkedIds.length !== 1) {
      return NextResponse.json(
        {
          error:
            "Natural-language time off requires exactly one linked commander.",
        },
        { status: 400 },
      );
    }
    const roster = await loadAllianceMembers(sessionId);
    const member = roster.members.find((m) => m.id === linkedIds[0]);
    if (!member) {
      return NextResponse.json({ error: "Commander not found on roster." }, { status: 400 });
    }
    payload = {
      ashedMemberId: member.id,
      memberName: member.current_name,
      startDate: parsed.parsed.startDate,
      endDate: parsed.parsed.endDate,
      notes: parsed.parsed.notes,
      availability: parsed.parsed.availability,
      entryKind: "planned",
      source: "web",
    };
  }

  const validationError = validateTimeOffEntryPayload(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const canManageOthers = !(await requireTimeOffWrite(sessionId));
  const ownsCommander =
    session.hqUserId != null &&
    (await hqUserOwnsCommander({
      allianceId,
      hqUserId: session.hqUserId,
      ashedMemberId: payload.ashedMemberId,
    }));

  if (!canManageOthers && !ownsCommander) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (
    payload.entryKind === "unexpected" ||
    payload.entryKind === "officer_marked"
  ) {
    const deniedWrite = await requireTimeOffWrite(sessionId);
    if (deniedWrite) return deniedWrite;
  }

  const row = await createTimeOffEntry({
    allianceId,
    payload: {
      ...payload,
      source: payload.source ?? (canManageOthers ? "officer" : "web"),
    },
    createdByHqUserId: session.hqUserId ?? null,
  });

  return NextResponse.json({
    entry: serializeTimeOffEntry(row),
  });
}
