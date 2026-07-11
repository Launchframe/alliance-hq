import { NextResponse } from "next/server";

import { getServerCalendarDate } from "@/lib/trains/game-time";
import { postPriceIsRightLeaderboardToDiscord } from "@/lib/trains/price-is-right-leaderboard-discord.server";
import { listRegisteredGuildsWithTrainChannel } from "@/lib/vr/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const workerSecret = process.env.TRAIN_PIR_LEADERBOARD_SECRET?.trim();
  return Boolean(workerSecret && auth === `Bearer ${workerSecret}`);
}

/** Manual / worker trigger — not scheduled; VS uploads may arrive after midnight. */
export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = getServerCalendarDate();
  const targets = await listRegisteredGuildsWithTrainChannel();
  const allianceIds = [
    ...new Set(targets.map((target) => target.allianceId)),
  ];
  let posted = 0;
  let skipped = 0;

  for (const allianceId of allianceIds) {
    try {
      const result = await postPriceIsRightLeaderboardToDiscord({
        allianceId,
        trainDate: today,
      });
      posted += result.posted;
      skipped += result.skipped;
    } catch (error) {
      console.error(
        "[train-pir-leaderboard] failed for alliance",
        allianceId,
        error,
      );
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, posted, skipped, date: today });
}
