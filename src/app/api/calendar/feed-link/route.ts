import { NextResponse } from "next/server";
import { requireCalendarUser, calendarErrorResponse } from "@/lib/calendar/access.server";
import { calendarFeedLink } from "@/lib/calendar/feed.server";
import { CalendarError } from "@/lib/calendar/types.shared";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await requireCalendarUser(request), body = await request.json();
    if (typeof body?.targetId !== "string") throw new CalendarError("invalid_request");
    return NextResponse.json({ url: await calendarFeedLink(user.hqUserId, body.targetId) }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return calendarErrorResponse(error); }
}
