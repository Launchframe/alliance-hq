import { NextResponse } from "next/server";

import { processVsDailyAnnouncements } from "@/lib/vs-calculator/discord-announcements.server";

/**
 * VS daily announcement cron.
 *
 * Scheduled `50 1 * * *` (UTC) in `vercel.json` — the game server runs
 * UTC−2, so this fires ~23:50 server time, just before the nightly reset.
 * The handler posts a *preview of tomorrow's* VS day
 * (`targetDate = server-today + 1`, see `processVsDailyAnnouncements`) so
 * officers see it while there's still time to save/spend resources before
 * reset. Do not move this earlier than ~22:00 server time (loses same-day
 * relevance) or past 00:00 server time (the "tomorrow" preview becomes today).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await processVsDailyAnnouncements();
  return NextResponse.json({ ok: true, ...result });
}
