import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { getAllianceRanksAsOf } from "@/lib/trains/rank-history";
import { confirmMemberRank } from "@/lib/trains/rank-sync";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { getRbacContext } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const date =
    new URL(request.url).searchParams.get("date")?.trim() ||
    getServerCalendarDate();

  const ranks = await getAllianceRanksAsOf(ctx.allianceId, date);
  return NextResponse.json({ date, ranks });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const rbac = await getRbacContext(session.id);

  const body = (await request.json()) as {
    ashedMemberId?: string;
    memberName?: string;
    allianceRank?: number;
    allianceRankTitle?: string | null;
    effectiveDate?: string;
    source?: "manual" | "video_parse" | "ashed_bootstrap";
  };

  if (!body.ashedMemberId?.trim() || !body.memberName?.trim()) {
    return NextResponse.json(
      { error: "ashedMemberId and memberName are required." },
      { status: 400 },
    );
  }

  const allianceRank = Number(body.allianceRank);
  if (!Number.isFinite(allianceRank)) {
    return NextResponse.json(
      { error: "allianceRank must be a number 1–5." },
      { status: 400 },
    );
  }

  try {
    const event = await confirmMemberRank({
      allianceId: ctx.allianceId,
      ashedMemberId: body.ashedMemberId.trim(),
      memberName: body.memberName.trim(),
      allianceRank,
      allianceRankTitle: body.allianceRankTitle?.trim() || null,
      effectiveDate: body.effectiveDate?.trim() || getServerCalendarDate(),
      source: body.source ?? "manual",
      recordedByHqUserId: rbac?.hqUserId ?? null,
      connection: ctx.connection,
    });
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rank save failed." },
      { status: 502 },
    );
  }
}
