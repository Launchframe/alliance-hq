import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireCalendarUser, calendarErrorResponse, calendarPrincipal, assertCalendarAllianceConsent } from "@/lib/calendar/access.server";
import { readCalendarPreferences } from "@/lib/calendar/repository.server";
import { calendarEvents } from "@/lib/calendar/sources.server";
import { CalendarError } from "@/lib/calendar/types.shared";
import { parseCalendarSources } from "@/lib/calendar/preferences.shared";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = await requireCalendarUser(request), params = new URL(request.url).searchParams;
    await assertCalendarAllianceConsent(user.id, user.hqUserId, params.get("allianceId") ?? "");
    const events = await getDb().transaction(async (tx) => {
      const principal = await calendarPrincipal(tx, user.hqUserId, params.get("allianceId") ?? "");
      if (!principal) throw new CalendarError("forbidden", 403);
      return calendarEvents(tx, principal, await readCalendarPreferences(tx, user.hqUserId), parseCalendarSources(params.getAll("source")));
    });
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarErrorResponse(error); }
}
