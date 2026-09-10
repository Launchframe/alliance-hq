import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { calendarErrorResponse, requireCalendarUser } from "@/lib/calendar/access.server";
import { CalendarError } from "@/lib/calendar/types.shared";
import { getDb, schema } from "@/lib/db";
import { beginBoarding, readBoarding, submitBoarding } from "@/lib/trains/boarding.server";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";

export const dynamic = "force-dynamic";

async function actor(request: Request) {
  const session = await requireCalendarUser(request);
  if (!session.currentAllianceId || await requireTrainOfficer(session.id)) throw new CalendarError("forbidden", 403);
  return { allianceId: session.currentAllianceId, id: `hq:${session.hqUserId}` };
}

export async function GET(request: Request) {
  try {
    const viewer = await actor(request), recordId = new URL(request.url).searchParams.get("recordId") ?? "";
    return NextResponse.json({ boarding: await readBoarding(viewer.allianceId, recordId, viewer.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const viewer = await actor(request), body = await request.json();
    if (body.action === "begin" && typeof body.recordId === "string") {
      await getDb().transaction(async (tx) => {
        await lockAllianceAvailability(tx, viewer.allianceId);
        const [record] = await tx.select().from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.id, body.recordId), eq(schema.trainConductorRecords.allianceId, viewer.allianceId))).for("update");
        if (!record?.lockedAt) throw new CalendarError("stale", 409);
        await beginBoarding(tx, record);
      });
    } else {
      await submitBoarding(viewer.allianceId, viewer.id, body);
    }
    return NextResponse.json({ boarding: await readBoarding(viewer.allianceId, body.recordId, viewer.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarErrorResponse(error); }
}
