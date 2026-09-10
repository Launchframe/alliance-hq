import { NextResponse } from "next/server";
import { requireCalendarUser, calendarErrorResponse, assertCalendarAllianceConsent } from "@/lib/calendar/access.server";
import { loadCalendarSettings } from "@/lib/calendar/settings.server";
import { configureCalendarTarget, saveCalendarPreferences } from "@/lib/calendar/repository.server";
import { CalendarError } from "@/lib/calendar/types.shared";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireCalendarUser(request);
    return NextResponse.json(await loadCalendarSettings(user.hqUserId, new URL(request.url).searchParams.get("locale") ?? "en-US"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireCalendarUser(request), body = await request.json();
    if (body?.action === "preferences") await saveCalendarPreferences(user.hqUserId, body.preferences, body.version);
    else if (body?.action === "target" && typeof body.allianceId === "string") {
      if (body.enabled === true) await assertCalendarAllianceConsent(user.id, user.hqUserId, body.allianceId);
      await configureCalendarTarget(user.hqUserId, body);
    }
    else throw new CalendarError("invalid_request");
    return NextResponse.json(await loadCalendarSettings(user.hqUserId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarErrorResponse(error); }
}
