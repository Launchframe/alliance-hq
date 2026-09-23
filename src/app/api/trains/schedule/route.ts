import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { loadTrainsDashboard } from "@/lib/trains/load-dashboard";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { sessionHasPermission } from "@/lib/rbac/context";
import {
  applyTemplateToWeek,
  clearWeekSchedule,
  getOrCreateWeekSchedule,
  getServerCalendarDate,
  getWeekStartMonday,
  trainActionErrorResponse,
} from "@/lib/trains/service";
import { getRuleTemplateForAlliance } from "@/lib/trains/rules/templates.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { requireApiSession } from "@/lib/session";
import {
  requireSessionPermission,
  requireTrainOfficer,
} from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const payload = await loadTrainsDashboard(session.id);
  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    templateId?: string;
    weekStart?: string;
    isPivot?: boolean;
  };

  const weekStart =
    body.weekStart?.trim() || getWeekStartMonday(getServerCalendarDate());
  const templateId = body.templateId?.trim();
  if (!templateId) {
    return NextResponse.json(
      { error: "A week template is required." },
      { status: 400 },
    );
  }

  // Tenant scope: presets, or a template this alliance owns.
  const template = await getRuleTemplateForAlliance(ctx.allianceId, templateId);
  if (!template) {
    return NextResponse.json(
      { error: "Week template not found." },
      { status: 404 },
    );
  }

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

  const isPlatformAdmin = await sessionHasPermission(session.id, "hq:admin");
  try {
    await applyTemplateToWeek(ctx.allianceId, weekStart, templateId, {
      platformAdminPastOverride: isPlatformAdmin,
      isPivot: body.isPivot === true,
    });
  } catch (error) {
    const { status, body: responseBody } = trainActionErrorResponse(error);
    return NextResponse.json(responseBody, { status });
  }

  const { schedule, dayConfigs } = await getOrCreateWeekSchedule(
    ctx.allianceId,
    weekStart,
    templateId,
  );

  await writeTrainsOfficerAudit({
    sessionId: session.id,
    allianceId: ctx.allianceId,
    hqUserId: session.hqUserId,
    action: "trains.schedule_set_week_template",
    severity: "update",
    resourceType: "train_week_schedule",
    resourceId: schedule.id ?? `${ctx.allianceId}:${weekStart}`,
    metadata: {
      weekStart,
      templateId,
      templateName: template.name,
      isPivot: body.isPivot === true,
    },
  });

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

  const sessionOrError = await requireApiSession();


  if (sessionOrError instanceof NextResponse) return sessionOrError;


  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const result = await clearWeekSchedule(ctx.allianceId, resolvedWeekStart);
  await writeTrainsOfficerAudit({
    sessionId: session.id,
    allianceId: ctx.allianceId,
    hqUserId: session.hqUserId,
    action: "trains.schedule_clear_week",
    severity: "update",
    resourceType: "train_week_schedule",
    resourceId: `${ctx.allianceId}:${resolvedWeekStart}`,
    metadata: {
      weekStart: resolvedWeekStart,
      ...result,
    },
  });
  return NextResponse.json({
    ok: true,
    weekStart: resolvedWeekStart,
    ...result,
  });
}
