import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  resolveScoreLeaderboardKind,
  type ScoreLeaderboardKind,
} from "@/lib/trains/score-leaderboard-podium.shared";
import { loadScoreLeaderboard } from "@/lib/trains/score-leaderboard.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { requireApiSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const KINDS: ScoreLeaderboardKind[] = ["tpif", "vs_push", "donations"];

function parseKind(value: string | null): ScoreLeaderboardKind | null {
  if (!value) return null;
  return KINDS.includes(value as ScoreLeaderboardKind)
    ? (value as ScoreLeaderboardKind)
    : null;
}

export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const params = new URL(request.url).searchParams;
  const trainDate = params.get("date")?.trim();
  const kindParam = parseKind(params.get("kind")?.trim() ?? null);

  if (!trainDate || !/^\d{4}-\d{2}-\d{2}$/.test(trainDate)) {
    return NextResponse.json(
      { error: "date query parameter (YYYY-MM-DD) is required." },
      { status: 400 },
    );
  }

  const { seasonKey } = await getEffectiveSeasonForAlliance(ctx.allianceId);
  const dayConfig = await resolveRollDayConfig(
    ctx.allianceId,
    trainDate,
    seasonKey,
  );

  const dayKind = resolveScoreLeaderboardKind({
    paintTemplate: dayConfig.paintTemplate,
    conductorMechanism: dayConfig.conductorMechanism,
  });

  if (!dayKind) {
    return NextResponse.json(
      { error: "This day does not use a score leaderboard." },
      { status: 400 },
    );
  }

  if (kindParam && kindParam !== dayKind) {
    return NextResponse.json(
      { error: "Score leaderboard kind does not match this day's rules." },
      { status: 400 },
    );
  }

  const resolvedKind = kindParam ?? dayKind;

  try {
    const payload = await loadScoreLeaderboard({
      allianceId: ctx.allianceId,
      trainDate,
      kind: resolvedKind,
      hqUserId: session.hqUserId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Load failed.";
    const status = message.includes("Price Is Freight") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
