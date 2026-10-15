import { NextResponse } from "next/server";

import { processVrDailyReports } from "@/lib/vr/daily-report.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const workerSecret = process.env.VR_DAILY_REPORT_SECRET?.trim();
  return Boolean(workerSecret && auth === `Bearer ${workerSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await processVrDailyReports();

  if (result.configured === 0) {
    return NextResponse.json(
      {
        error:
          "No report channels configured. Owners should run /set-vr-report-channel, or set DISCORD_GUILD_ID + DISCORD_VR_REPORT_CHANNEL_ID for legacy single-tenant.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    posted: result.posted,
    skipped: result.skipped,
  });
}
