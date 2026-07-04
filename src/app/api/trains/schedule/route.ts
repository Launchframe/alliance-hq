import { NextResponse } from "next/server";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { loadTrainsDashboard } from "@/lib/trains/load-dashboard";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import {
  clearWeekSchedule,
  getOrCreateWeekSchedule,
  getServerCalendarDate,
  getWeekStartMonday,
  setWeekTemplate,
} from "@/lib/trains/service";
import type { WeekTemplateType } from "@/lib/trains/types";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { getOrCreateSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const payload = await loadTrainsDashboard(session.id);
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    templateType?: WeekTemplateType;
    weekStart?: string;
    isPivot?: boolean;
  };

  const weekStart =
    body.weekStart?.trim() || getWeekStartMonday(getServerCalendarDate());
  const templateType = body.templateType ?? "vs_push_week";

  const members = await loadActiveAlliancePoolMembers({
    allianceId: ctx.allianceId,
  });
  if (members.length === 0) {
    return NextResponse.json(
      {
        error: "Import alliance members before creating a train schedule.",
        code: "empty_pool",
      },
      { status: 409 },
    );
  }

  await setWeekTemplate(
    ctx.allianceId,
    weekStart,
    templateType,
    body.isPivot === true,
  );

  const { schedule, dayConfigs } = await getOrCreateWeekSchedule(
    ctx.allianceId,
    weekStart,
    templateType,
  );

  return NextResponse.json({ schedule, dayConfigs });
}

/** Pre-production only: clear a persisted week schedule back to draft preview. */
export async function DELETE(request: Request) {
  if (!isDevOrPreviewEnvironment()) {
    return new NextResponse(null, { status: 404 });
  }

  let weekStart: string | undefined;
  try {
    const body = (await request.json()) as { weekStart?: string };
    weekStart = body.weekStart?.trim() || undefined;
  } catch {
    weekStart = undefined;
  }

  const resolvedWeekStart =
    weekStart || getWeekStartMonday(getServerCalendarDate());
  if (!DATE_PATTERN.test(resolvedWeekStart)) {
    return NextResponse.json(
      { error: "weekStart must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const result = await clearWeekSchedule(ctx.allianceId, resolvedWeekStart);
  return NextResponse.json({
    ok: true,
    weekStart: resolvedWeekStart,
    ...result,
  });
}
