import { NextResponse } from "next/server";

import { createTimeOff, previewTimeOff } from "@/lib/time-off/mutations.server";
import { dualWriteTimeOffToAshed } from "@/lib/time-off/excused-sync.server";
import { parseTimeOffMessage } from "@/lib/time-off/parse-natural-language.shared";
import { requireTimeOffActor, timeOffErrorResponse } from "@/lib/time-off/route-helpers.server";
import { TimeOffError } from "@/lib/time-off/workflow.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await requireTimeOffActor();
  if ("error" in context) return context.error;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TimeOffError("commanderRequired");
    let payload = body;
    if (typeof body.naturalLanguage === "string" && body.naturalLanguage.trim()) {
      const parsed = parseTimeOffMessage(body.naturalLanguage.trim(), getServerCalendarDate());
      if (!parsed.ok) throw new TimeOffError("parseFailed");
      payload = { ...body, startDate: parsed.parsed.startDate, endDate: parsed.parsed.endDate, notes: typeof body.notes === "string" && body.notes.trim() ? body.notes : parsed.parsed.notes };
    }
    // Attribution is server-derived — ignore client-provided `source`.
    if (body.preview === true) return NextResponse.json({ draft: await previewTimeOff(context.actor, payload) });
    const entry = await createTimeOff(context.actor, payload, body.requestId);
    const ashedSyncFailed = await dualWriteTimeOffToAshed({
      allianceId: context.actor.allianceId,
      entryId: entry.id,
      sessionId: context.actor.sessionId,
      discordUserId: context.actor.discordUserId,
      operation: "upsert",
    });
    return NextResponse.json({ entry, ashedSyncFailed });
  } catch (error) {
    return timeOffErrorResponse(error);
  }
}
