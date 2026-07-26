import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/ops/cron-auth";
import { runCron } from "@/lib/ops/run-cron";
import { processDepartingSoonReminders } from "@/lib/trains/discord-bot.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return runCron("train-departing-soon", async () => {
    const result = await processDepartingSoonReminders();
    return { ...result, processed: result.posted };
  });
}
