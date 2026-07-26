import { NextResponse } from "next/server";

import { runEurTick } from "@/lib/eur/run-tick";
import { runRosterLinkReminderPass } from "@/lib/member-link/roster-link-reminders.server";
import { authorizeCron } from "@/lib/ops/cron-auth";
import { runCron } from "@/lib/ops/run-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCron(request, { alternateEnvKeys: ["VIDEO_WORKER_SECRET"] })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return runCron("eur-tick", async () => {
    const result = await runEurTick();
    const rosterLinkRemindersSent = await runRosterLinkReminderPass();
    return {
      ...result,
      rosterLinkRemindersSent,
      processed:
        result.occurrencesCreated +
        result.remindersMaterialized +
        rosterLinkRemindersSent,
    };
  });
}
