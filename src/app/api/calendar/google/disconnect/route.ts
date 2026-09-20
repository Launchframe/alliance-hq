import { NextResponse } from "next/server";
import { calendarErrorResponse, requireCalendarUser } from "@/lib/calendar/access.server";
import { disconnectGoogleCalendar } from "@/lib/calendar/google-account.server";
import { loadCalendarSettings } from "@/lib/calendar/settings.server";
import { CalendarError } from "@/lib/calendar/types.shared";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await requireCalendarUser(request), body = await request.json();
    if (!Number.isSafeInteger(body?.version) || typeof body.cleanup !== "boolean") throw new CalendarError("invalid_request");
    await disconnectGoogleCalendar(user.hqUserId, body.cleanup, body.version);
    return NextResponse.json(await loadCalendarSettings(user.hqUserId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarErrorResponse(error); }
}
