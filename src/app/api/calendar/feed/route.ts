import { calendarFeed, calendarFeedHeaders } from "@/lib/calendar/feed.server";
import { CalendarError } from "@/lib/calendar/types.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const result = await calendarFeed(new URL(request.url).searchParams.get("token") ?? "", request.headers.get("if-none-match"));
    return new Response(result.status === 304 ? null : result.text, { status: result.status, headers: { ...calendarFeedHeaders, ETag: result.etag } });
  } catch (error) {
    return new Response(null, { status: error instanceof CalendarError ? error.status : 503, headers: { ...calendarFeedHeaders, "Cache-Control": "no-store" } });
  }
}
