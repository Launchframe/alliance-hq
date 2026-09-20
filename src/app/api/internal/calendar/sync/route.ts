import { NextResponse } from "next/server";
import { runCalendarTick } from "@/lib/calendar/google-worker.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ code: "forbidden" }, { status: 403, headers });
  try {
    const result = await runCalendarTick();
    return NextResponse.json(result, { status: result.failed ? 503 : 200, headers });
  } catch { return NextResponse.json({ code: "failed" }, { status: 503, headers }); }
}
