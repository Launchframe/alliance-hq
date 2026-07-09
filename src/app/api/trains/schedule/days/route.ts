import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/rbac/context";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  applyTemplateToDates,
  getServerCalendarDate,
  trainActionErrorResponse,
} from "@/lib/trains/service";
import { canOfficerChangeTemplateForDate } from "@/lib/trains/trains-day-actions.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import { WEEK_TEMPLATES } from "@/lib/trains/types";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const isPlatformAdmin = await sessionHasPermission(session.id, "hq:admin");
  const today = getServerCalendarDate();

  return NextResponse.json({
    today,
    canPaintPastDays: isPlatformAdmin,
    canOfficerPaintPastDays: false,
    officerPaintAllowedFrom: today,
  });
}

export async function PATCH(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    dates?: string[];
    templateType?: WeekTemplateType;
    updateWeekTemplate?: boolean;
  };

  const dates = (body.dates ?? []).filter(
    (date): date is string =>
      typeof date === "string" && DATE_PATTERN.test(date.trim()),
  );
  if (dates.length === 0) {
    return NextResponse.json(
      { error: "At least one valid date is required." },
      { status: 400 },
    );
  }

  const templateType = body.templateType;
  if (!templateType || !WEEK_TEMPLATES.includes(templateType)) {
    return NextResponse.json(
      { error: "A valid templateType is required." },
      { status: 400 },
    );
  }

  const isPlatformAdmin = await sessionHasPermission(session.id, "hq:admin");
  const today = getServerCalendarDate();
  const blockedPastDates = dates.filter(
    (date) => !canOfficerChangeTemplateForDate(date, today),
  );
  if (blockedPastDates.length > 0 && !isPlatformAdmin) {
    return NextResponse.json(
      {
        error: `Cannot change template for past day ${blockedPastDates[0]}.`,
      },
      { status: 409 },
    );
  }

  try {
    await applyTemplateToDates(ctx.allianceId, dates, templateType, {
      platformAdminPastOverride: isPlatformAdmin,
      updateWeekTemplate: body.updateWeekTemplate === true,
    });
    return NextResponse.json({ ok: true, dates, templateType });
  } catch (error) {
    const { status, body: responseBody } = trainActionErrorResponse(error);
    return NextResponse.json(responseBody, { status });
  }
}
