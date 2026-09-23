import { NextResponse } from "next/server";
import { calendarErrorResponse, requireCalendarUser } from "@/lib/calendar/access.server";
import { calendarAppOrigin } from "@/lib/calendar/origin.server";
import { googleCalendarCookieName, startGoogleCalendar } from "@/lib/calendar/google-oauth.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await requireCalendarUser(request);
    const result = await startGoogleCalendar(user.hqUserId);
    const response = NextResponse.json({ url: result.url }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    response.cookies.set(googleCalendarCookieName(), result.state, { httpOnly: true, secure: calendarAppOrigin().startsWith("https:"), sameSite: "lax", path: "/", maxAge: 900 });
    return response;
  } catch (error) { return calendarErrorResponse(error); }
}
