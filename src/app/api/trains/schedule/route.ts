import { NextResponse } from "next/server";

import { loadTrainsDashboard } from "@/lib/trains/load-dashboard";
import {
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
