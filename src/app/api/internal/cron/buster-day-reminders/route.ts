import { NextResponse } from "next/server";

import { runBusterDayReminderPass } from "@/lib/vs-performance/buster-day-reminders.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runBusterDayReminderPass();
  return NextResponse.json({ ok: true, ...result });
}
