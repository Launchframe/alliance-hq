import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireCalendarUser } from "@/lib/calendar/access.server";
import { googleCalendarCookieName, finishGoogleCalendar } from "@/lib/calendar/google-oauth.server";
import { calendarAppOrigin } from "@/lib/calendar/origin.server";
import { calendarOAuthFailureCode } from "@/lib/calendar/types.shared";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let status = "failed", reason = "failed";
  try {
    const user = await requireCalendarUser();
    const params = new URL(request.url).searchParams, state = params.get("state") ?? "", saved = (await cookies()).get(googleCalendarCookieName())?.value ?? "";
    if (!/^[\w-]{43}$/.test(state) || saved.length !== state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(saved))) throw new Error("invalid_state");
    await finishGoogleCalendar(user.hqUserId, state, params.get("code") ?? "");
    status = "connected";
  } catch (error) {
    reason = calendarOAuthFailureCode(error);
    console.warn("[calendar] Google OAuth callback failed", { code: reason });
  }
  const redirect = new URL(`/account/calendars?calendar=${status}`, calendarAppOrigin());
  if (status === "failed") redirect.searchParams.set("reason", reason);
  const response = NextResponse.redirect(redirect);
  response.cookies.set(googleCalendarCookieName(), "", { httpOnly: true, secure: calendarAppOrigin().startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
